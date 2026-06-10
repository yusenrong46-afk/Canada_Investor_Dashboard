from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from halifax_model import core as halifax_core  # noqa: E402

TRAINING_CSV = REPO_ROOT / "data" / "processed" / "halifax_base_model_training.csv"

FULL_POSTAL_CENTROID = (44.636, -63.585)
FSA_CENTROID = (44.640, -63.590)
MARKET_CENTROID = (44.700, -63.600)


class _StubClusterer:
    def predict(self, coords):  # noqa: ANN001, ANN201 - mirrors the KMeans predict signature
        return [3] * len(coords)


def _tiny_bundle() -> object:
    return type(
        "Bundle",
        (),
        {
            "full_postal_centroids": {"B3H1A1": FULL_POSTAL_CENTROID},
            "fsa_centroids": {"B3H": FSA_CENTROID},
            "market_centroid": MARKET_CENTROID,
            "age_medians": {"Detached": 38.0},
            "numeric_medians": {"ageYears": 38.0},
            "location_clusterer": _StubClusterer(),
        },
    )()


def _payload(**overrides) -> dict:
    payload = {
        "postalCode": "B3H 1A1",
        "propertyType": "Detached",
        "livingAreaSqft": 1800,
        "bedrooms": 3,
        "bathrooms": 2,
        "yearBuilt": 1990,
    }
    payload.update(overrides)
    return payload


def test_condo_request_is_rejected_with_pvsc_explanation() -> None:
    with pytest.raises(ValueError) as excinfo:
        halifax_core._normalize_request(_payload(propertyType="Condo"), _tiny_bundle())

    message = str(excinfo.value)
    assert "PVSC open data does not cover" in message
    assert "condo unit characteristics" in message
    assert "Detached, Townhouse, and Duplex" in message


def test_unknown_property_type_names_supported_types() -> None:
    with pytest.raises(ValueError, match="Detached, Townhouse, or Duplex"):
        halifax_core._normalize_request(_payload(propertyType="Castle"), _tiny_bundle())


def test_vancouver_postal_is_rejected() -> None:
    with pytest.raises(ValueError, match="Halifax / Maritimes postal code"):
        halifax_core._normalize_request(_payload(postalCode="V6B 1X9"), _tiny_bundle())


def test_non_postal_text_is_rejected() -> None:
    with pytest.raises(ValueError, match="Halifax / Maritimes postal code"):
        halifax_core._normalize_request(_payload(postalCode="not a postal code"), _tiny_bundle())


def test_living_area_below_floor_is_rejected() -> None:
    with pytest.raises(ValueError, match="livingAreaSqft"):
        halifax_core._normalize_request(_payload(livingAreaSqft=100), _tiny_bundle())


def test_centroid_fallback_prefers_full_postal_then_fsa_then_market() -> None:
    bundle = _tiny_bundle()

    assert halifax_core._resolve_centroid(bundle, "B3H1A1") == FULL_POSTAL_CENTROID
    assert halifax_core._resolve_centroid(bundle, "B3H9Z9") == FSA_CENTROID
    assert halifax_core._resolve_centroid(bundle, "B4B0M9") == MARKET_CENTROID


def test_normalize_request_uses_postal_centroid_and_year_built() -> None:
    property_data = halifax_core._normalize_request(_payload(), _tiny_bundle())

    assert property_data["postalCode"] == "B3H1A1"
    assert property_data["postalFsa"] == "B3H"
    assert (property_data["latitude"], property_data["longitude"]) == FULL_POSTAL_CENTROID
    assert property_data["submarketCluster"] == "cluster-03"
    assert property_data["ageYears"] is not None


def test_normalize_request_falls_back_to_age_median_when_year_built_missing() -> None:
    property_data = halifax_core._normalize_request(_payload(yearBuilt=None), _tiny_bundle())

    assert property_data["ageYears"] == 38.0


@pytest.mark.slow
@pytest.mark.skipif(not TRAINING_CSV.exists(), reason="Halifax training extract CSV is not present")
def test_estimate_property_returns_conformal_halifax_estimate() -> None:
    pytest.importorskip("sklearn")

    result = halifax_core.estimate_property(_payload())

    assert result["market"] == "halifax_maritimes"
    assert result["marketLabel"] == "Halifax / Maritimes"
    assert result["modelVersion"] == "halifax-base-price-v1"
    assert result["trainingMode"] == "halifax-real-sales"
    assert result["confidenceLow"] < result["baseValue"] < result["confidenceHigh"]
    assert result["uncertainty"]["method"] == "conformal"
    assert result["uncertainty"]["targetCoverage"] == 0.8
    assert result["explanationMethod"] in {"shap", "heuristic"}
    assert result["drivers"]
    assert result["marketContext"]["cityMedianValue"] == result["marketContext"]["vancouverMedianValue"]
    assert result["marketContext"]["cityMedianPricePerSqft"] == result["marketContext"]["vancouverMedianPricePerSqft"]
    assert result["marketFreshness"]["status"] == "embedded-in-target"
    assert "time-adjusted" in result["marketFreshness"]["message"]
