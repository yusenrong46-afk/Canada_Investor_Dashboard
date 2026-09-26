from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "artifacts" / "model-service"))

from halifax_model import core as halifax_core  # noqa: E402


def _rows(test_price: float) -> pd.DataFrame:
    records = []
    for month in range(1, 31):
        year = 2022 + (month - 1) // 12
        month_of_year = ((month - 1) % 12) + 1
        for index in range(4):
            records.append(
                {
                    "salePrice": 300_000 + index * 10_000,
                    "saleDate": pd.Timestamp(year, month_of_year, 15),
                    "price": 1.0,
                    "livingAreaSqft": 1500 + index * 50,
                    "propertyType": "Detached",
                    "postalFsa": "B3H",
                    "bedrooms": 3,
                    "bathrooms": 2,
                    "latitude": 44.65,
                    "longitude": -63.6,
                    "ageYears": 20,
                    "assessedValue": 9_999_999,
                }
            )
    frame = pd.DataFrame(records)
    frame.loc[frame["saleDate"] >= "2024-01-01", "salePrice"] = test_price
    return frame


def test_pre_holdout_index_ignores_later_sale_prices_and_assessed_value():
    quiet, quiet_meta = halifax_core._rebuild_target_from_pre_holdout_sales(_rows(400_000))
    shocked, shocked_meta = halifax_core._rebuild_target_from_pre_holdout_sales(_rows(5_000_000))
    assert quiet_meta["rebuilt"] is True
    assert quiet_meta["holdoutMonthsInIndex"] == []
    assert shocked_meta["baselineMonth"] == quiet_meta["baselineMonth"]
    cutoff = pd.Timestamp(quiet_meta["testStart"])
    quiet_earlier = quiet.loc[quiet["saleDate"] < cutoff, "price"]
    shocked_earlier = shocked.loc[shocked["saleDate"] < cutoff, "price"]
    assert quiet_earlier.tolist() == shocked_earlier.tolist()
    assert set(quiet_earlier) != {1.0}

    features, _categorical = halifax_core._resolve_feature_columns(_rows(400_000))
    assert "assessedValue" not in features


def test_training_load_keeps_rows_instead_of_filtering_on_assessed_value(tmp_path: Path):
    frame = pd.DataFrame(
        [
            {
                "price": 500_000,
                "propertyType": "Detached",
                "postalCode": "B3H1A1",
                "livingAreaSqft": 1800,
                "bedrooms": 3,
                "bathrooms": 2,
                "latitude": 44.65,
                "longitude": -63.6,
                "ageYears": 20,
                "salePrice": 480_000,
                "saleDate": "2024-06-01",
                "assessedValue": 1,
            },
            {
                "price": 450_000,
                "propertyType": "Townhouse",
                "postalCode": "B3J2B2",
                "livingAreaSqft": 1400,
                "bedrooms": 3,
                "bathrooms": 2,
                "latitude": 44.66,
                "longitude": -63.61,
                "ageYears": 15,
                "salePrice": 440_000,
                "saleDate": "2024-06-02",
                "assessedValue": 430_000,
            },
        ]
    )
    path = tmp_path / "halifax.csv"
    frame.to_csv(path, index=False)
    usable, _counts, _summary = halifax_core._load_training_frame(str(path))
    assert len(usable) == 2
    assert "assessedValue" not in usable.columns


def test_old_bundle_with_assessed_value_reports_the_serving_gap():
    class Bundle:
        numeric_features = ["livingAreaSqft", "assessedValue"]

    note = halifax_core.serving_limitation(Bundle())
    assert note is not None
    assert "assessed value" in note.lower()

    class Current:
        numeric_features = ["livingAreaSqft"]

    assert halifax_core.serving_limitation(Current()) is None
