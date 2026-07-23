from __future__ import annotations

import logging
import os
from pathlib import Path

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException

from common.artifact_loader import ModelArtifactError


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


def create_app() -> Flask:
    _load_local_env()

    from routes import register_routes

    flask_app = Flask(__name__)
    register_routes(flask_app)

    @flask_app.errorhandler(ModelArtifactError)
    def handle_artifact_error(error: ModelArtifactError):
        return jsonify({"error": {"code": "ARTIFACT_UNAVAILABLE", "message": str(error)}}), 503

    @flask_app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        if isinstance(error, HTTPException):
            return error
        logging.exception("Unhandled model-service error")
        return jsonify({"error": {"code": "INTERNAL", "message": "An internal error occurred"}}), 500

    return flask_app


app = create_app()


if __name__ == "__main__":
    from base_model import load_bundle as load_vancouver_bundle
    from halifax_model import load_bundle as load_halifax_bundle

    # Startup loads approved immutable artifacts only. Training is an offline command.
    load_vancouver_bundle()
    load_halifax_bundle()
    host = os.environ.get("MODEL_SERVICE_HOST", "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
    port = int(os.environ.get("MODEL_SERVICE_PORT", os.environ.get("PORT", "5001")))
    app.run(host=host, port=port, debug=False)
