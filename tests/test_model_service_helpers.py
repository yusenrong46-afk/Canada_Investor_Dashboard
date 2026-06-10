from __future__ import annotations

import sys
from pathlib import Path

MODEL_SERVICE_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from service import _age_from_year_built, _driver_candidates, _market_freshness_payload, _normalize_postal_code, _normalize_property_type, _parse_numeric  # noqa: E402
from uplift_service import _extract_flag_map, _normalize_address, _normalize_zip, calculate_uplift_percent, load_sales, require_real_csv, simulate_uplift  # noqa: E402


def test_normalize_postal_code_accepts_vancouver_format() -> None:
    assert _normalize_postal_code("v6b 1x9") == "V6B1X9"


def test_normalize_postal_code_rejects_invalid_values() -> None:
    assert _normalize_postal_code("not a postal code") is None


def test_normalize_property_type_maps_common_listing_words() -> None:
    assert _normalize_property_type("Single Family", "") == "Detached"
    assert _normalize_property_type("", "Apartment/Condo") == "Condo"
    assert _normalize_property_type("", "Townhouse") == "Townhouse"
    assert _normalize_property_type("", "Duplex") == "Duplex"


def test_parse_numeric_handles_listing_style_strings() -> None:
    assert _parse_numeric("$1,250,000") == 1_250_000
    assert _parse_numeric("708 sqft") == 708
    assert _parse_numeric("") is None


def test_age_from_year_built_uses_current_year() -> None:
    assert _age_from_year_built(2006) is not None
    assert _age_from_year_built(1799) is None


def test_market_index_adjustment_uses_real_rows(tmp_path: Path) -> None:
    market_file = tmp_path / "market.csv"
    market_file.write_text(
        "Date,Region,Property Type,Benchmark Price\n"
        "2024-01-01,Vancouver,Condo,100\n"
        "2026-01-01,Vancouver,Condo,110\n",
    )
    bundle = type(
        "Bundle",
        (),
        {
            "market_index_path": str(market_file),
            "training_date_range": {"latestListingDate": "2024-01-01"},
        },
    )()

    result = _market_freshness_payload(bundle, "Condo")

    assert result["status"] == "adjusted"
    assert result["multiplier"] == 1.1


def test_heuristic_drivers_are_tagged_with_source() -> None:
    bundle = type(
        "Bundle",
        (),
        {
            "type_feature_medians": {"Condo": {"livingAreaSqft": 700.0, "bedrooms": 1.0, "bathrooms": 1.0, "ageYears": 20.0}},
            "type_price_medians": {"Condo": 800_000.0},
            "city_stats": {"medianPrice": 1_000_000.0, "medianPricePerSqft": 1_000.0},
            "evaluation_summary": {"perType": {"Condo": {"ageYearsMissingRate": 1.0}}},
        },
    )()
    local_stats = {"medianPrice": 1_200_000.0, "medianPricePerSqft": 1_100.0, "count": 30}
    property_data = {"propertyType": "Condo", "livingAreaSqft": 900.0, "bedrooms": 2.0, "bathrooms": 2.0, "ageYears": None}

    drivers = _driver_candidates(property_data, bundle, local_stats, market_multiplier=1.0)

    assert drivers
    assert all(driver["source"] == "heuristic" for driver in drivers)


def test_load_bundle_retrains_when_artifact_lacks_conformal_calibrations(monkeypatch, tmp_path: Path) -> None:
    import pickle

    from base_model import core

    # Mimic unpickling a pre-v5 artifact: a real bundle instance without conformal_calibrations.
    legacy_bundle = object.__new__(core.VancouverModelBundle)
    legacy_bundle.__dict__.update({"data_path": "legacy.csv"})
    artifact_path = tmp_path / "vancouver_base_price_bundle_v5.pkl"
    with artifact_path.open("wb") as artifact_file:
        pickle.dump(legacy_bundle, artifact_file)

    sentinel = object()
    monkeypatch.setattr(core, "ARTIFACT_PATH", artifact_path)
    monkeypatch.setattr(core, "_BUNDLE", None)
    monkeypatch.setattr(core, "train_bundle", lambda data_path: sentinel)

    result = core.load_bundle(force_retrain=False, data_path="legacy.csv")

    assert result is sentinel


def test_uplift_math_uses_market_adjusted_percent() -> None:
    uplift = calculate_uplift_percent(previous_price=800_000, next_price=920_000, market_factor=1.10)

    assert round(uplift, 4) == 0.0455


def test_uplift_keywords_classify_permit_text() -> None:
    flags = _extract_flag_map("Alteration to remodel kitchen cabinets and replace roof")

    assert flags["renovatedKitchen"] == 1
    assert flags["roofIssueResolved"] == 1


def test_king_county_address_normalization_removes_trailing_zip() -> None:
    assert _normalize_address("26910 86TH AVE S 98030") == "26910 86TH AVE S"
    assert _normalize_zip("26910 86TH AVE S 98030") == "98030"


def test_uplift_requires_real_csv_files(tmp_path: Path) -> None:
    missing_file = tmp_path / "missing.csv"

    try:
        require_real_csv(missing_file, "Seattle building permits")
    except FileNotFoundError as error:
        assert "Missing real Seattle building permits CSV" in str(error)
    else:
        raise AssertionError("Expected missing real CSV to fail clearly")


def test_king_county_sales_loader_accepts_official_document_date(tmp_path: Path) -> None:
    sales_file = tmp_path / "rpsale_extr.csv"
    sales_file.write_text(
        '"Major","Minor","DocumentDate","SalePrice","PropertyType","PrincipalUse","SaleReason","PropertyClass","SaleWarning"\n'
        '"123456","0001","20240115","850000","11","2","1","8",""\n',
    )

    sales = load_sales(sales_file)

    assert len(sales) == 1
    assert sales.iloc[0]["pin"] == "1234560001"
    assert int(sales.iloc[0]["salePrice"]) == 850000


def test_king_county_sales_loader_accepts_slash_document_date(tmp_path: Path) -> None:
    sales_file = tmp_path / "rpsale_extr.csv"
    sales_file.write_text(
        '"Major","Minor","DocumentDate","SalePrice","PropertyType","PrincipalUse","SaleReason","PropertyClass","SaleWarning"\n'
        '"123456","0001","01/15/2024","850000","11","2","1","8",""\n',
    )

    sales = load_sales(sales_file)

    assert len(sales) == 1
    assert sales.iloc[0]["saleDate"].year == 2024


def test_zero_selected_improvements_returns_zero_without_training(monkeypatch) -> None:
    def estimate_stub(_payload: dict) -> dict:
        return {
            "baseValue": 1_000_000,
            "marketContext": {"practicalCeiling": 1_300_000},
        }

    monkeypatch.setattr("uplift_service.estimate_property", estimate_stub)

    result = simulate_uplift({"plannedFlags": []})

    assert result["status"] == "ready"
    assert result["upliftPercent"] == 0
    assert result["upliftValue"] == 0
