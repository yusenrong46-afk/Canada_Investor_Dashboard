"""The estimate contract must be identical regardless of which architecture serves.

Trains both production architectures on a small synthetic raw-listings CSV and asserts
estimate_property returns the same key set (and the local preprocessor harmlessly drops the
propertyType feature, while pooled uses one shared model). Marked slow because it trains models.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
if str(MODEL_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_SERVICE_DIR))

pytest.importorskip("sklearn")

import base_model.core as core  # noqa: E402

_TYPES = [
    ("Single Family", "", "Detached", 950.0),
    ("", "Apartment/Condo", "Condo", 1100.0),
    ("", "Townhouse", "Townhouse", 850.0),
    ("", "Duplex", "Duplex", 800.0),
]
_FSAS = ["V6B", "V6E", "V6G", "V6Z", "V5K", "V5L", "V5T", "V6A", "V6C", "V6H", "V6J", "V6K"]


def _synthetic_listings(rows_per_type: int = 80) -> pd.DataFrame:
    records = []
    for type_index, (property_type, type_col, _label, base_psf) in enumerate(_TYPES):
        for index in range(rows_per_type):
            sqft = 600 + (index % 25) * 60
            psf = base_psf * (1.0 + 0.01 * (index % 17))
            fsa = _FSAS[(type_index * 5 + index) % len(_FSAS)]
            lat = 49.20 + ((index * 3 + type_index) % 30) * 0.003
            lon = -123.20 + ((index * 7 + type_index) % 24) * 0.006
            records.append(
                {
                    "addressLocality": "Vancouver",
                    "Property Type": property_type,
                    "Type": type_col,
                    "price": round(sqft * psf, -3) + 500_000,
                    "property-sqft": sqft,
                    "property-beds": 1 + (index % 4),
                    "property-baths": 1 + (index % 3),
                    "Year Built": 1955 + (index % 60),
                    "latitude": round(lat, 5),
                    "longitude": round(lon, 5),
                    "postalCode": f"{fsa} {1 + index % 9}A{index % 9}",
                }
            )
    return pd.DataFrame(records)


@pytest.fixture(scope="module")
def synthetic_csv(tmp_path_factory: pytest.TempPathFactory) -> str:
    path = tmp_path_factory.mktemp("listings") / "vancouver_listings.csv"
    _synthetic_listings().to_csv(path, index=False)
    return str(path)


def _estimate_with(bundle) -> dict:
    core._BUNDLE = bundle
    payload = {
        "postalCode": "V6B 1A1",
        "propertyType": "Condo",
        "livingAreaSqft": 850,
        "bedrooms": 2,
        "bathrooms": 2,
        "latitude": 49.281,
        "longitude": -123.118,
    }
    return core.estimate_property(payload)


@pytest.mark.slow
def test_estimate_contract_is_architecture_invariant(synthetic_csv):
    local_bundle = core.train_bundle(data_path=synthetic_csv, architecture=core.ARCHITECTURE_LOCAL)
    pooled_bundle = core.train_bundle(data_path=synthetic_csv, architecture=core.ARCHITECTURE_POOLED)

    # Pooled shares one fitted model across all types; local has a distinct model per type.
    assert len({id(model) for model in pooled_bundle.models.values()}) == 1
    assert len({id(model) for model in local_bundle.models.values()}) == len(local_bundle.models)
    assert pooled_bundle.model_architecture == core.ARCHITECTURE_POOLED
    assert pooled_bundle.model_version == core.POOLED_MODEL_VERSION

    local_estimate = _estimate_with(local_bundle)
    pooled_estimate = _estimate_with(pooled_bundle)
    core._BUNDLE = None

    assert set(local_estimate.keys()) == set(pooled_estimate.keys())
    assert set(local_estimate["modelQuality"].keys()) == set(pooled_estimate["modelQuality"].keys())
    for estimate in (local_estimate, pooled_estimate):
        assert estimate["baseValue"] > 0
        assert estimate["confidenceLow"] <= estimate["baseValue"] <= estimate["confidenceHigh"]
        assert estimate["uncertainty"]["method"] == "conformal"
