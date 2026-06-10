from __future__ import annotations

from typing import Any

from flask import Flask, jsonify, request

from base_model import estimate_property, health_payload
from halifax_model import estimate_property as estimate_halifax_property, halifax_health_payload
from halifax_uplift import simulate_uplift as simulate_halifax_uplift
from trend_service import market_trend_payload
from uplift_model import simulate_uplift, uplift_health_payload


def _is_halifax_postal(payload: dict[str, Any]) -> bool:
    return str(payload.get("postalCode") or "").strip().upper().startswith("B")


def register_routes(app: Flask) -> None:
    @app.get("/health")
    def health() -> tuple[dict, int]:
        vancouver_payload = health_payload()
        try:
            halifax_payload = halifax_health_payload()
        except Exception as error:  # a missing Halifax bundle must not hide the Vancouver health report
            halifax_payload = {"ok": False, "market": "halifax_maritimes", "message": str(error)}
        payload = dict(vancouver_payload)
        payload["uplift"] = uplift_health_payload()
        payload["markets"] = {
            "vancouver": vancouver_payload,
            "halifax_maritimes": halifax_payload,
        }
        return jsonify(payload), 200

    @app.post("/estimate")
    def estimate() -> tuple[dict, int]:
        payload = request.get_json(silent=True) or {}
        try:
            if _is_halifax_postal(payload):
                return jsonify(estimate_halifax_property(payload)), 200
            return jsonify(estimate_property(payload)), 200
        except ValueError as error:
            return jsonify({"message": str(error)}), 400

    @app.post("/uplift")
    def uplift() -> tuple[dict, int]:
        payload = request.get_json(silent=True) or {}
        try:
            if _is_halifax_postal(payload):
                # Observed HRM-permit medians; categories without enough treated pairs raise a 400.
                return jsonify(simulate_halifax_uplift(payload)), 200
            return jsonify(simulate_uplift(payload)), 200
        except ValueError as error:
            return jsonify({"message": str(error)}), 400

    @app.get("/trend")
    def trend() -> tuple[dict, int]:
        market = request.args.get("market", "")
        return jsonify(market_trend_payload(market)), 200
