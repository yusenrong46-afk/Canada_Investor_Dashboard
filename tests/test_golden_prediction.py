from __future__ import annotations

import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from common.artifact_loader import build_manifest_entry, upsert_manifest_entry  # noqa: E402


def _synthetic_training_frame(rows: int = 200) -> pd.DataFrame:
    rng = np.random.default_rng(11)
    records = []
    for index in range(rows):
        records.append(
            {
                "price": float(rng.integers(500_000, 1_500_000)),
                "propertyType": "Condo" if index % 2 == 0 else "Townhouse",
                "postalCode": "V6B1X9" if index % 2 == 0 else "V5T3K4",
                "postalFsa": "V6B" if index % 2 == 0 else "V5T",
                "livingAreaSqft": float(rng.integers(600, 1400)),
                "bedrooms": float(rng.integers(1, 4)),
                "bathrooms": float(rng.integers(1, 3)),
                "latitude": 49.28 + rng.normal(0, 0.01),
                "longitude": -123.12 + rng.normal(0, 0.01),
                "ageYears": float(rng.integers(5, 40)),
                "propertyTax": float(rng.integers(2000, 5000)),
            }
        )
    frame = pd.DataFrame(records)
    frame["logPrice"] = np.log(frame["price"])
    frame["pricePerSqft"] = frame["price"] / frame["livingAreaSqft"]
    frame["lat_x_lon"] = frame["latitude"] * frame["longitude"]
    frame["lat_sq"] = frame["latitude"] ** 2
    frame["lon_sq"] = frame["longitude"] ** 2
    return frame


def _load_synthetic_training_frame(data_path: str):
    from base_model import core

    frame = pd.read_csv(data_path)
    frame["listingDate"] = pd.Timestamp("2024-03-01")
    usable = frame[frame["propertyType"].isin(core.PROPERTY_TYPES)].copy()
    row_counts = {
        "totalRows": len(frame),
        "vancouverRows": len(frame),
        "usableRowsBeforeOutlierRemoval": len(usable),
        "usableRows": len(usable),
    }
    property_types = sorted(usable["propertyType"].unique())
    eda_summary = {
        "trainingDateRange": {"firstListingDate": "2024-01-01", "latestListingDate": "2024-06-01"},
        "missingnessByPropertyType": {
            property_type: {"ageYears": {"missingRate": 0.0}}
            for property_type in property_types
        },
    }
    return usable, row_counts, eda_summary


@pytest.mark.slow
def test_synthetic_bundle_round_trip_prediction_is_stable(tmp_path: Path, monkeypatch) -> None:
    from base_model import core

    csv_path = tmp_path / "synthetic_vancouver.csv"
    _synthetic_training_frame().to_csv(csv_path, index=False)

    artifact_path = tmp_path / "synthetic_vancouver_bundle.pkl"
    market_index = tmp_path / "market_index.csv"
    market_index.write_text(
        "Date,Region,Property Type,Benchmark Price\n"
        "2024-01-01,Vancouver,Condo,100\n"
        "2026-01-01,Vancouver,Condo,110\n"
    )

    monkeypatch.setattr(core, "_load_training_frame", _load_synthetic_training_frame)
    monkeypatch.setattr(core, "ARTIFACT_PATH", artifact_path)
    monkeypatch.setattr(core, "DEFAULT_MARKET_INDEX_PATH", str(market_index))
    monkeypatch.setattr(core, "_BUNDLE", None)

    bundle = core.train_bundle(data_path=str(csv_path))
    upsert_manifest_entry(
        artifact_path,
        build_manifest_entry(
            artifact_path,
            model_version=bundle.model_version,
            trained_at=bundle.trained_at,
        ),
    )

    first = core.estimate_property(
        {
            "postalCode": "V6B 1X9",
            "propertyType": "Condo",
            "livingAreaSqft": 900,
            "bedrooms": 2,
            "bathrooms": 2,
        }
    )
    expected_value = first["baseValue"]

    monkeypatch.setattr(core, "_BUNDLE", None)
    reloaded = core.load_bundle()
    assert reloaded.model_version == bundle.model_version

    with artifact_path.open("rb") as artifact_file:
        raw_bundle = pickle.load(artifact_file)
    assert raw_bundle.model_version == bundle.model_version

    second = core.estimate_property(
        {
            "postalCode": "V6B 1X9",
            "propertyType": "Condo",
            "livingAreaSqft": 900,
            "bedrooms": 2,
            "bathrooms": 2,
        }
    )
    assert second["baseValue"] == expected_value
