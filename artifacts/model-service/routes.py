from __future__ import annotations

from flask import Flask, jsonify, request

from service import estimate_property, health_payload
from uplift_service import simulate_uplift, uplift_health_payload


def register_routes(app: Flask) -> None:
    @app.get("/health")
    def health() -> tuple[dict, int]:
        payload = health_payload()
        payload["uplift"] = uplift_health_payload()
        return jsonify(payload), 200

    @app.post("/estimate")
    def estimate() -> tuple[dict, int]:
        payload = request.get_json(silent=True) or {}
        try:
            return jsonify(estimate_property(payload)), 200
        except ValueError as error:
            return jsonify({"message": str(error)}), 400

    @app.post("/uplift")
    def uplift() -> tuple[dict, int]:
        payload = request.get_json(silent=True) or {}
        try:
            return jsonify(simulate_uplift(payload)), 200
        except ValueError as error:
            return jsonify({"message": str(error)}), 400
