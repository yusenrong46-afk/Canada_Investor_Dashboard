from __future__ import annotations

import logging
import traceback
from typing import Any

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from base_model import estimate_property, metrics_payload as vancouver_metrics_payload, slim_health_payload
from halifax_model import estimate_property as estimate_halifax_property
from halifax_model.core import HALIFAX_PREFIX_PATTERN, metrics_payload as halifax_metrics_payload, slim_health_payload as halifax_slim_health_payload
from halifax_uplift import simulate_uplift as simulate_halifax_uplift
from service import _parse_numeric
from trend_service import market_trend_payload
from uplift_model import simulate_uplift, uplift_health_payload

from common.artifact_loader import ModelArtifactError


MAX_BEDROOMS = 12
MAX_BATHROOMS = 12
MIN_LIVING_AREA_SQFT = 100
MAX_LIVING_AREA_SQFT = 20_000
MAX_PRICE_FIELD = 25_000_000


def _is_halifax_postal(payload: dict[str, Any]) -> bool:
    postal_code = str(payload.get("postalCode") or "").strip().upper().replace(" ", "")
    return bool(postal_code and HALIFAX_PREFIX_PATTERN.match(postal_code))


def _request_json() -> tuple[dict[str, Any] | None, tuple[Any, int] | None]:
    content_type = (request.content_type or "").lower()
    if "application/json" in content_type and request.data:
        try:
            payload = request.get_json(silent=False)
        except Exception:
            return None, (
                jsonify({"error": {"code": "INVALID_JSON", "message": "Request body is not valid JSON"}}),
                400,
            )
        return payload if isinstance(payload, dict) else {}, None
    return request.get_json(silent=True) or {}, None


def _validate_input_bounds(payload: dict[str, Any]) -> str | None:
    living_area = _parse_numeric(payload.get("livingAreaSqft"))
    if living_area is not None and not MIN_LIVING_AREA_SQFT <= living_area <= MAX_LIVING_AREA_SQFT:
        return f"livingAreaSqft must be between {MIN_LIVING_AREA_SQFT} and {MAX_LIVING_AREA_SQFT}"

    bedrooms = _parse_numeric(payload.get("bedrooms"))
    if bedrooms is not None and not 0 <= bedrooms <= MAX_BEDROOMS:
        return f"bedrooms must be between 0 and {MAX_BEDROOMS}"

    bathrooms = _parse_numeric(payload.get("bathrooms"))
    if bathrooms is not None and not 0 <= bathrooms <= MAX_BATHROOMS:
        return f"bathrooms must be between 0 and {MAX_BATHROOMS}"

    for field in ("knownCurrentValue", "price", "purchasePrice", "targetPrice"):
        value = _parse_numeric(payload.get(field))
        if value is not None and value > MAX_PRICE_FIELD:
            return f"{field} must be at most {MAX_PRICE_FIELD:,}"

    return None


def _market_health(name: str, loader) -> dict[str, Any]:
    try:
        payload = loader()
        payload.setdefault("ok", True)
        return payload
    except Exception as error:
        return {"ok": False, "market": name, "message": str(error)}


def register_routes(app: Flask) -> None:
    @app.get("/health")
    def health() -> tuple[Any, int]:
        vancouver_payload = _market_health("vancouver", slim_health_payload)
        halifax_payload = _market_health("halifax_maritimes", halifax_slim_health_payload)
        uplift_payload = uplift_health_payload()
        payload = {
            "ok": vancouver_payload.get("ok", False) and halifax_payload.get("ok", False),
            "service": "model-service",
            "markets": {
                "vancouver": vancouver_payload,
                "halifax_maritimes": halifax_payload,
            },
            "uplift": {
                "ready": uplift_payload.get("ready", False),
                "modelVersion": uplift_payload.get("modelVersion"),
            },
        }
        status = 200 if payload["ok"] else 503
        return jsonify(payload), status

    @app.get("/metrics")
    def metrics() -> tuple[Any, int]:
        try:
            payload = {
                "service": "model-service",
                "markets": {
                    "vancouver": vancouver_metrics_payload(),
                    "halifax_maritimes": halifax_metrics_payload(),
                },
                "uplift": uplift_health_payload(),
            }
        except ModelArtifactError as error:
            return jsonify({"error": {"code": "ARTIFACT_UNAVAILABLE", "message": str(error)}}), 503
        return jsonify(payload), 200

    @app.post("/estimate")
    def estimate() -> tuple[Any, int]:
        payload, error_response = _request_json()
        if error_response is not None:
            return error_response
        assert payload is not None

        bounds_error = _validate_input_bounds(payload)
        if bounds_error is not None:
            return jsonify({"error": {"code": "VALIDATION", "message": bounds_error}}), 400

        try:
            if _is_halifax_postal(payload):
                return jsonify(estimate_halifax_property(payload)), 200
            return jsonify(estimate_property(payload)), 200
        except ValueError as error:
            return jsonify({"error": {"code": "VALIDATION", "message": str(error)}}), 400
        except ModelArtifactError as error:
            return jsonify({"error": {"code": "ARTIFACT_UNAVAILABLE", "message": str(error)}}), 503

    @app.post("/uplift")
    def uplift() -> tuple[Any, int]:
        payload, error_response = _request_json()
        if error_response is not None:
            return error_response
        assert payload is not None

        bounds_error = _validate_input_bounds(payload)
        if bounds_error is not None:
            return jsonify({"error": {"code": "VALIDATION", "message": bounds_error}}), 400

        try:
            if _is_halifax_postal(payload):
                return jsonify(simulate_halifax_uplift(payload)), 200
            return jsonify(simulate_uplift(payload)), 200
        except ValueError as error:
            return jsonify({"error": {"code": "VALIDATION", "message": str(error)}}), 400
        except ModelArtifactError as error:
            return jsonify({"error": {"code": "ARTIFACT_UNAVAILABLE", "message": str(error)}}), 503

    @app.get("/trend")
    def trend() -> tuple[Any, int]:
        market = request.args.get("market", "")
        return jsonify(market_trend_payload(market)), 200
