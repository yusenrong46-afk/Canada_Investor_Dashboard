from pathlib import Path

import json

import pandas as pd
import pytest

from scripts.setup_halifax_data import build_training_extract, _map_style_to_property_type


def _dwellings_frame() -> pd.DataFrame:
    base = {
        "municipal_unit": "HALIFAX REGIONAL MUNICIPALITY (HRM)",
        "living_units": 1,
        "under_construction": "N",
        "bathrooms": 2,
        "grade": "Average",
        "finished_basement": "Y",
        "garage": "N",
    }
    return pd.DataFrame(
        [
            {**base, "aan": "1", "style": "2 Storey", "square_foot_living_area": 1800, "bedrooms": 3, "year_built": 1990, "y_coord": 44.6500, "x_coord": -63.6000},
            {**base, "aan": "2", "style": "2 Storey Townhouse", "square_foot_living_area": 1400, "bedrooms": None, "year_built": 2005, "y_coord": 44.6600, "x_coord": -63.6100},
            {**base, "aan": "3", "style": "1 Storey Semi Detached", "square_foot_living_area": 1100, "bedrooms": 2, "year_built": 1975, "y_coord": 44.6700, "x_coord": -63.6200},
            {**base, "aan": "4", "style": "Manufactured Home", "square_foot_living_area": 900, "bedrooms": 2, "year_built": 1995, "y_coord": 44.6800, "x_coord": -63.6300},
        ]
    )


def _sales_frame() -> pd.DataFrame:
    rows = []
    # Older market sales so the monthly index has history before the window.
    for month in ("2021-03-15", "2021-04-15", "2021-05-15"):
        rows.append({"aan": "9", "sale_price": 400_000, "sale_date": month, "parcels_in_sale": 1})
    rows.extend(
        [
            # Two sales for aan 1: only the most recent should be kept.
            {"aan": "1", "sale_price": 500_000, "sale_date": "2022-02-10", "parcels_in_sale": 1},
            {"aan": "1", "sale_price": 600_000, "sale_date": "2024-06-10", "parcels_in_sale": 1},
            {"aan": "2", "sale_price": 450_000, "sale_date": "2024-06-12", "parcels_in_sale": 1},
            {"aan": "3", "sale_price": 380_000, "sale_date": "2024-06-20", "parcels_in_sale": 1},
            {"aan": "4", "sale_price": 250_000, "sale_date": "2024-06-25", "parcels_in_sale": 1},
        ]
    )
    frame = pd.DataFrame(rows)
    frame["y_coord"] = None
    frame["x_coord"] = None
    return frame


def _assessments_frame() -> pd.DataFrame:
    rows = []
    for aan in ("1", "2", "3", "4"):
        rows.append({"aan": aan, "tax_year": 2025, "assessed_value": 300_000, "taxable_assessed_value": 280_000})
        rows.append({"aan": aan, "tax_year": 2026, "assessed_value": 333_000, "taxable_assessed_value": 300_000})
    return pd.DataFrame(rows)


def _civic_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"PID": "10", "CIV_POSTAL": "B3H 1A1", "latitude": 44.6500, "longitude": -63.6000},
            {"PID": "11", "CIV_POSTAL": "B3J 2B2", "latitude": 44.6600, "longitude": -63.6100},
            {"PID": "12", "CIV_POSTAL": "B3K 3C3", "latitude": 44.6700, "longitude": -63.6200},
            # No civic point near aan 4's manufactured home, but it is style-excluded anyway.
        ]
    )


def test_style_mapping_matches_recon_decisions():
    assert _map_style_to_property_type("2 Storey") == "Detached"
    assert _map_style_to_property_type("Split Entry") == "Detached"
    assert _map_style_to_property_type("2 Storey Townhouse") == "Townhouse"
    assert _map_style_to_property_type("1 Storey Semi Detached") == "Duplex"
    assert _map_style_to_property_type("2 Storey Duplex") == "Duplex"
    assert _map_style_to_property_type("Manufactured Home") is None
    assert _map_style_to_property_type("Additon") is None
    assert _map_style_to_property_type(None) is None


def test_build_training_extract_joins_and_normalizes(tmp_path: Path):
    pytest.importorskip("sklearn")

    dwellings_path = tmp_path / "dwellings.csv"
    sales_path = tmp_path / "sales.csv"
    assessments_path = tmp_path / "assessments.csv"
    civic_path = tmp_path / "civic.csv"
    output_path = tmp_path / "halifax_training.csv"
    summary_path = tmp_path / "halifax_summary.json"

    _dwellings_frame().to_csv(dwellings_path, index=False)
    _sales_frame().to_csv(sales_path, index=False)
    _assessments_frame().to_csv(assessments_path, index=False)
    _civic_frame().to_csv(civic_path, index=False)

    summary = build_training_extract(
        dwellings_path=dwellings_path,
        sales_path=sales_path,
        assessments_path=assessments_path,
        civic_addresses_path=civic_path,
        output_path=output_path,
        summary_path=summary_path,
    )

    extract = pd.read_csv(output_path)

    # Manufactured home (aan 4) is style-excluded; the other three survive.
    assert len(extract) == 3
    assert sorted(extract["propertyType"]) == ["Detached", "Duplex", "Townhouse"]

    # Only the latest sale per aan is kept, time-adjusted to the newest index month.
    detached = extract[extract["propertyType"] == "Detached"].iloc[0]
    assert detached["salePrice"] == 600_000
    assert detached["timeAdjustmentFactor"] >= 0.5
    assert detached["price"] == pytest.approx(detached["salePrice"] * detached["timeAdjustmentFactor"])

    # Postal codes come from the nearest civic-address point.
    assert detached["postalCode"] == "B3H1A1"
    assert detached["postalFsa"] == "B3H"

    # The latest assessment year wins.
    assert (extract["assessedValue"] == 333_000).all()

    # Missing bedrooms are imputed and flagged.
    townhouse = extract[extract["propertyType"] == "Townhouse"].iloc[0]
    assert townhouse["bedroomsImputed"]
    assert townhouse["bedrooms"] > 0

    assert summary["targetName"] == "sale_price_time_adjusted"
    assert summary["rows"]["cleanTrainingRows"] == 3
    saved_summary = json.loads(summary_path.read_text())
    assert saved_summary["rates"]["postalMatchWithin150m"] == 1.0


def test_build_training_extract_requires_raw_files(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="dwelling characteristics"):
        build_training_extract(
            dwellings_path=tmp_path / "missing.csv",
            sales_path=tmp_path / "missing2.csv",
            assessments_path=tmp_path / "missing3.csv",
            civic_addresses_path=tmp_path / "missing4.csv",
            output_path=tmp_path / "out.csv",
            summary_path=tmp_path / "summary.json",
        )
