from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

MODEL_SERVICE_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from scripts.build_market_trend import build_market_trend  # noqa: E402
import trend_service  # noqa: E402


def _synthetic_nhpi_frame() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    periods = pd.period_range("2014-01", periods=120, freq="M")
    rows = []
    for geo, base, slope in (
        ("Vancouver, British Columbia", 100.0, 0.35),
        ("Halifax, Nova Scotia", 95.0, 0.25),
    ):
        noise = rng.normal(0, 0.4, len(periods))
        for position, period in enumerate(periods):
            rows.append(
                {
                    "REF_DATE": str(period),
                    "GEO": geo,
                    "New housing price indexes": "Total (house and land)",
                    "UOM": "Index, 201612=100",
                    "VALUE": round(base + slope * position + noise[position], 1),
                }
            )
        # Other components must be filtered out, not blended in.
        rows.append(
            {
                "REF_DATE": str(periods[0]),
                "GEO": geo,
                "New housing price indexes": "House only",
                "UOM": "Index, 201612=100",
                "VALUE": 999.9,
            }
        )
    return pd.DataFrame(rows)


def test_build_exports_history_and_forecasts_for_both_markets(tmp_path: Path):
    csv_path = tmp_path / "18100205.csv"
    export_path = tmp_path / "market_trend.json"
    _synthetic_nhpi_frame().to_csv(csv_path, index=False)

    summary = build_market_trend(
        csv_path=csv_path,
        export_path=export_path,
        warehouse_path=tmp_path / "absent.duckdb",
    )

    payload = json.loads(export_path.read_text())
    assert set(payload["markets"]) == {"vancouver", "halifax_maritimes"}
    assert summary.warehouse_table_written is False

    for market_id in ("vancouver", "halifax_maritimes"):
        market = payload["markets"][market_id]
        assert market["status"] == "ready"
        assert market["baselinePeriod"] == "2023-12"
        assert market["method"].startswith("ETS(A,")

        mape = market["backtestMape"]
        assert isinstance(mape, float)
        assert math.isfinite(mape)
        assert mape > 0

        history = [point for point in market["points"] if point["indexValue"] is not None]
        forecasts = [point for point in market["points"] if point["indexValue"] is None]
        assert len(forecasts) == 12
        assert forecasts[0]["period"] == "2024-01"
        for point in history:
            assert point["forecastValue"] is None
            assert point["forecastLow"] is None
            assert point["forecastHigh"] is None
        for point in forecasts:
            assert point["forecastLow"] <= point["forecastValue"] <= point["forecastHigh"]


def test_missing_csv_fails_clearly_and_writes_no_export(tmp_path: Path):
    export_path = tmp_path / "market_trend.json"

    with pytest.raises(FileNotFoundError, match="18100205-eng.zip"):
        build_market_trend(
            csv_path=tmp_path / "absent.csv",
            export_path=export_path,
            warehouse_path=tmp_path / "absent.duckdb",
        )

    assert not export_path.exists()


def test_trend_service_reports_missing_export(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MARKET_TREND_EXPORT_PATH", str(tmp_path / "missing.json"))

    result = trend_service.market_trend_payload("vancouver")

    assert result["status"] == "unavailable"
    assert "build_market_trend" in result["message"]


def test_trend_service_returns_market_verbatim_and_flags_unknown_market(tmp_path: Path, monkeypatch):
    export_path = tmp_path / "market_trend.json"
    vancouver = {"status": "ready", "market": "vancouver", "points": []}
    export_path.write_text(json.dumps({"markets": {"vancouver": vancouver}}))
    monkeypatch.setenv("MARKET_TREND_EXPORT_PATH", str(export_path))

    assert trend_service.market_trend_payload("vancouver") == vancouver

    unknown = trend_service.market_trend_payload("moon_base")
    assert unknown["status"] == "unavailable"
    assert "vancouver" in unknown["message"]
