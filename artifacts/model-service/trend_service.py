from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "market_trend.json"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

_EXPORT_CACHE: dict[str, dict[str, Any]] = {}


def _export_path() -> Path:
    override = os.environ.get("MARKET_TREND_EXPORT_PATH")
    if override:
        return Path(override)
    from scripts.release_store import resolve_published_export

    return resolve_published_export(REPO_ROOT, "market_trend.json")


def _load_export(path: Path) -> Any:
    if not path.exists():
        return None

    mtime = path.stat().st_mtime
    cached = _EXPORT_CACHE.get(str(path))
    if cached is not None and cached["mtime"] == mtime:
        return cached["payload"]

    payload = json.loads(path.read_text(encoding="utf-8"))
    _EXPORT_CACHE[str(path)] = {"mtime": mtime, "payload": payload}
    return payload


def market_trend_payload(market_id: str) -> dict:
    path = _export_path()
    export = _load_export(path)
    if export is None:
        return {
            "status": "unavailable",
            "message": f"Market trend export not found at {path}. Run scripts/build_market_trend.py to generate it.",
        }

    markets = export.get("markets") or {}
    market = markets.get(market_id)
    if market is None:
        available = ", ".join(sorted(markets)) or "none"
        return {
            "status": "unavailable",
            "message": f"Unknown market '{market_id}'. Available markets: {available}.",
        }
    return market
