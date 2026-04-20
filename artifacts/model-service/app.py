from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, jsonify, request


def _load_local_env() -> None:
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_local_env()

from service import estimate_property, health_payload, load_bundle
from uplift_service import simulate_uplift, uplift_health_payload

app = Flask(__name__)


@app.get("/health")
def health() -> tuple[str, int] | tuple[dict, int]:
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


if __name__ == "__main__":
    load_bundle(force_retrain=os.environ.get("MODEL_SERVICE_FORCE_RETRAIN") == "1")
    host = os.environ.get("MODEL_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("MODEL_SERVICE_PORT", "5001"))
    app.run(host=host, port=port, debug=False)
