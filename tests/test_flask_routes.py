from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
MODELS_DIR = MODEL_SERVICE_DIR / "models"
REQUIRED_LIVE_ARTIFACTS = (
    MODELS_DIR / "vancouver_base_price_bundle_v5.pkl",
    MODELS_DIR / "halifax_base_price_bundle_v1.pkl",
)
HAS_REQUIRED_LIVE_ARTIFACTS = all(path.is_file() for path in REQUIRED_LIVE_ARTIFACTS)
sys.path.insert(0, str(MODEL_SERVICE_DIR))


@pytest.fixture()
def flask_client():
    from app import create_app

    return create_app().test_client()


@pytest.mark.skipif(
    not HAS_REQUIRED_LIVE_ARTIFACTS,
    reason="Approved Vancouver/Halifax .pkl artifacts are not present in this checkout",
)
def test_health_returns_200_when_required_markets_load(flask_client) -> None:
    response = flask_client.get("/health")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["markets"]["vancouver"]["ok"] is True
    assert payload["markets"]["halifax_maritimes"]["ok"] is True
    assert "evaluationSummary" not in payload["markets"]["vancouver"]


def test_health_returns_503_when_required_market_fails(flask_client) -> None:
    with patch("routes.slim_health_payload", side_effect=RuntimeError("artifact missing")):
        response = flask_client.get("/health")
    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["markets"]["vancouver"]["ok"] is False


def test_invalid_json_returns_400(flask_client) -> None:
    response = flask_client.post(
        "/estimate",
        data="{not-json",
        content_type="application/json",
    )
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "INVALID_JSON"


def test_halifax_routing_uses_prefix_pattern_not_bare_letter(flask_client) -> None:
    with patch("routes.estimate_halifax_property", return_value={"market": "halifax"}) as halifax_estimate:
        with patch("routes.estimate_property", return_value={"market": "vancouver"}) as vancouver_estimate:
            halifax_response = flask_client.post(
                "/estimate",
                json={
                    "postalCode": "B3H 1A1",
                    "propertyType": "Detached",
                    "livingAreaSqft": 1800,
                    "bedrooms": 3,
                    "bathrooms": 2,
                },
            )
            vancouver_response = flask_client.post(
                "/estimate",
                json={
                    "postalCode": "BXYZ 1A1",
                    "propertyType": "Detached",
                    "livingAreaSqft": 1800,
                    "bedrooms": 3,
                    "bathrooms": 2,
                },
            )

    assert halifax_response.status_code == 200
    halifax_estimate.assert_called_once()
    vancouver_estimate.assert_called_once()
    assert vancouver_response.status_code == 200


def test_input_upper_bounds_return_400(flask_client) -> None:
    response = flask_client.post(
        "/estimate",
        json={
            "postalCode": "V6B 1X9",
            "propertyType": "Condo",
            "livingAreaSqft": 25_000,
            "bedrooms": 3,
            "bathrooms": 2,
        },
    )
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "VALIDATION"


@pytest.mark.skipif(
    not HAS_REQUIRED_LIVE_ARTIFACTS,
    reason="Approved Vancouver/Halifax .pkl artifacts are not present in this checkout",
)
def test_metrics_exposes_full_evaluation_payload(flask_client) -> None:
    response = flask_client.get("/metrics")
    assert response.status_code == 200
    payload = response.get_json()
    assert "evaluationSummary" in payload["markets"]["vancouver"]


def test_missing_artifact_returns_503_json(flask_client, monkeypatch, tmp_path: Path) -> None:
    from base_model import core
    from common.artifact_loader import ModelArtifactError

    monkeypatch.setattr(core, "ARTIFACT_PATH", tmp_path / "missing.pkl")
    monkeypatch.setattr(core, "_BUNDLE", None)
    (tmp_path / "MANIFEST.json").write_text(json.dumps({"schemaVersion": 1, "artifacts": []}))

    def _fail_load():
        raise ModelArtifactError("Approved Vancouver base-model artifact is missing: missing.pkl.")

    monkeypatch.setattr("routes.slim_health_payload", _fail_load)

    response = flask_client.get("/health")
    assert response.status_code == 503
