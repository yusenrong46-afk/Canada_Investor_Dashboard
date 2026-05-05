from __future__ import annotations

import os
from pathlib import Path

from flask import Flask


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
    return flask_app


app = create_app()


if __name__ == "__main__":
    from service import load_bundle

    load_bundle(force_retrain=os.environ.get("MODEL_SERVICE_FORCE_RETRAIN") == "1")
    host = os.environ.get("MODEL_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("MODEL_SERVICE_PORT", "5001"))
    app.run(host=host, port=port, debug=False)
