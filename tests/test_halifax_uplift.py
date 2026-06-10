from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

import halifax_model  # noqa: E402
from halifax_uplift import core as uplift_core  # noqa: E402
from scripts.build_halifax_uplift import build_repeat_sale_pairs, classify_pairs  # noqa: E402

FLAG_CATEGORY_MAP = {
    "renovatedKitchen": "Renovation",
    "renovatedBathrooms": "Renovation",
    "energyEfficient": "Renovation",
    "deferredMaintenanceResolved": "Renovation",
    "roofIssueResolved": "Renovation",
    "legalSuiteAdded": "Addition",
}

BASE_VALUE = 500_000
PRACTICAL_CEILING = 2_000_000


def _category(status: str, treated: int, median: float | None, p25: float | None, p75: float | None) -> dict:
    return {
        "status": status,
        "treatedPairs": treated,
        "controlPairs": 16_445,
        "medianExcessUpliftPercent": median,
        "p25ExcessUpliftPercent": p25,
        "p75ExcessUpliftPercent": p75,
        "medianPermitValue": 35_000 if status == "ready" else None,
        "note": "fixture",
    }


def _write_export(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, addition_ready: bool = False) -> dict:
    export = {
        "generatedAt": "2026-06-09T00:00:00Z",
        "source": "fixture source",
        "method": "fixture method paragraph",
        "baselineMonth": "2026-05",
        "minTreatedPairs": 100,
        "categories": {
            "Renovation": _category("ready", 131, 0.12, -0.004, 0.56),
            "Addition": (
                _category("ready", 120, 0.2, 0.05, 0.4)
                if addition_ready
                else _category("insufficient-data", 37, None, None, None)
            ),
        },
        "flagCategoryMap": dict(FLAG_CATEGORY_MAP),
    }
    path = tmp_path / "halifax_uplift.json"
    path.write_text(json.dumps(export), encoding="utf-8")
    monkeypatch.setenv("HALIFAX_UPLIFT_EXPORT_PATH", str(path))
    return export


@pytest.fixture
def fake_base_estimate(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake(payload: dict) -> dict:
        return {"baseValue": BASE_VALUE, "marketContext": {"practicalCeiling": PRACTICAL_CEILING}}

    monkeypatch.setattr(halifax_model, "estimate_property", _fake)


def _payload(**overrides) -> dict:
    payload = {
        "postalCode": "B3H 1A1",
        "propertyType": "Detached",
        "livingAreaSqft": 1800,
        "bedrooms": 3,
        "bathrooms": 2,
        "plannedFlags": ["renovatedKitchen"],
    }
    payload.update(overrides)
    return payload


def test_flags_map_and_dedupe_to_one_renovation_category(tmp_path, monkeypatch, fake_base_estimate) -> None:
    _write_export(tmp_path, monkeypatch)

    result = uplift_core.simulate_uplift(_payload(plannedFlags=["renovatedKitchen", "renovatedBathrooms"]))

    assert result["status"] == "ready"
    assert result["upliftPercent"] == pytest.approx(0.12)
    assert result["upliftValue"] == round(BASE_VALUE * 0.12)
    assert result["upliftPercentConfidenceLow"] == pytest.approx(-0.004)
    assert result["upliftPercentConfidenceHigh"] == pytest.approx(0.56)
    assert result["plannedFlags"] == ["renovatedKitchen", "renovatedBathrooms"]
    assert len(result["topUpliftDrivers"]) == 1
    assert result["topUpliftDrivers"][0]["upliftPercent"] == pytest.approx(0.12)
    assert any("counted once" in note for note in result["methodNotes"])


def test_ready_categories_sum_across_renovation_and_addition(tmp_path, monkeypatch, fake_base_estimate) -> None:
    _write_export(tmp_path, monkeypatch, addition_ready=True)

    result = uplift_core.simulate_uplift(
        _payload(plannedFlags=["renovatedKitchen", "roofIssueResolved", "legalSuiteAdded"])
    )

    assert result["upliftPercent"] == pytest.approx(0.32)
    assert result["upliftPercentConfidenceLow"] == pytest.approx(-0.004 + 0.05)
    assert result["upliftPercentConfidenceHigh"] == pytest.approx(0.56 + 0.4)
    assert result["upliftValue"] == round(BASE_VALUE * 0.32)
    assert {driver["upliftPercent"] for driver in result["topUpliftDrivers"]} == {0.12, 0.2}
    assert result["rowCounts"]["treatedPairsRenovation"] == 131
    assert result["rowCounts"]["treatedPairsAddition"] == 120


def test_insufficient_category_contributes_zero_with_note(tmp_path, monkeypatch, fake_base_estimate) -> None:
    _write_export(tmp_path, monkeypatch)

    result = uplift_core.simulate_uplift(_payload(plannedFlags=["renovatedKitchen", "legalSuiteAdded"]))

    assert result["upliftPercent"] == pytest.approx(0.12)
    insufficient_notes = [note for note in result["methodNotes"] if "contribute zero uplift" in note]
    assert len(insufficient_notes) == 1
    assert "Addition" in insufficient_notes[0]
    assert "37" in insufficient_notes[0]
    assert result["rowCounts"]["treatedPairsAddition"] == 37


def test_no_ready_category_raises_with_measured_counts(tmp_path, monkeypatch, fake_base_estimate) -> None:
    _write_export(tmp_path, monkeypatch)

    with pytest.raises(ValueError) as excinfo:
        uplift_core.simulate_uplift(_payload(plannedFlags=["legalSuiteAdded"]))

    message = str(excinfo.value)
    assert "Addition" in message
    assert "37" in message
    assert "100" in message


def test_vancouver_postal_is_rejected(tmp_path, monkeypatch, fake_base_estimate) -> None:
    _write_export(tmp_path, monkeypatch)

    with pytest.raises(ValueError, match="Halifax / Maritimes postal code"):
        uplift_core.simulate_uplift(_payload(postalCode="V6B 1X9"))


def test_condo_is_rejected_with_pvsc_explanation(tmp_path, monkeypatch, fake_base_estimate) -> None:
    _write_export(tmp_path, monkeypatch)

    with pytest.raises(ValueError, match="condo unit characteristics"):
        uplift_core.simulate_uplift(_payload(propertyType="Condo"))


# --- pair building on a tiny synthetic market -------------------------------

# Market level doubles between early 2023 and early 2024; filler sales keep
# each month's median exactly at the level so the smoothed index is flat
# within each regime and the adjusted control ratio lands at 1.0.
def _synthetic_sales() -> pd.DataFrame:
    rows = []
    filler_id = 100
    for month, level in (
        ("2023-01-15", 200_000),
        ("2023-02-15", 200_000),
        ("2023-03-15", 200_000),
        ("2024-01-15", 400_000),
        ("2024-02-15", 400_000),
        ("2024-03-15", 400_000),
    ):
        for _ in range(3):
            rows.append({"aan": str(filler_id), "sale_price": level, "sale_date": month})
            filler_id += 1

    for aan in ("1", "2", "3"):  # treated / control / new-building pairs
        rows.append({"aan": aan, "sale_price": 200_000, "sale_date": "2023-02-15"})
        rows.append({"aan": aan, "sale_price": 400_000, "sale_date": "2024-02-15"})
    # gap below 180 days: no pair
    rows.append({"aan": "4", "sale_price": 200_000, "sale_date": "2023-02-15"})
    rows.append({"aan": "4", "sale_price": 200_000, "sale_date": "2023-03-15"})
    # below the market-price floor: no pair
    rows.append({"aan": "5", "sale_price": 50_000, "sale_date": "2023-02-15"})
    rows.append({"aan": "5", "sale_price": 60_000, "sale_date": "2024-02-15"})
    return pd.DataFrame(rows)


def _synthetic_permits() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"aan": "1", "issuedDate": pd.Timestamp("2023-08-01"), "workScope": "Renovation", "projectValue": 40_000},
            {"aan": "1", "issuedDate": pd.Timestamp("2022-01-01"), "workScope": "Addition", "projectValue": 10_000},
            {"aan": "3", "issuedDate": pd.Timestamp("2023-08-01"), "workScope": "New Building", "projectValue": 900_000},
        ]
    )


def test_pair_building_classification_and_time_adjustment() -> None:
    pairs, baseline_month = build_repeat_sale_pairs(_synthetic_sales())

    assert baseline_month == "2024-03"
    assert sorted(pairs["aan"]) == ["1", "2", "3"]
    assert pairs["rawRatio"].to_numpy() == pytest.approx([2.0, 2.0, 2.0])
    # doubling market drift is fully removed by the monthly index
    assert pairs["adjustedRatio"].to_numpy() == pytest.approx([1.0, 1.0, 1.0])

    treated, control, permit_values = classify_pairs(pairs, _synthetic_permits())

    assert list(treated["Renovation"]["aan"]) == ["1"]  # permit before the pair window does not count
    assert treated["Addition"].empty
    assert list(control["aan"]) == ["2"]  # aan 3 has a New Building permit: neither treated nor control
    assert permit_values["Renovation"].tolist() == [40_000.0]
