from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WAREHOUSE_PATH = REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb"
DEFAULT_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "market_map.json"

# Only cells with enough observations to summarize honestly appear on the map.
MIN_CELL_ROWS = 5

MARKET_LABELS = {"vancouver": "Vancouver", "halifax_maritimes": "Halifax / Maritimes"}
MARKET_ZOOM = {"vancouver": 12, "halifax_maritimes": 10}


def _import_duckdb():
    try:
        import duckdb  # type: ignore[import-not-found]
    except ModuleNotFoundError as exc:
        raise RuntimeError("DuckDB is required to export the market map. Install it with `.venv/bin/pip install duckdb`.") from exc
    return duckdb


def _cell_boundary(cell: str) -> list[list[float]]:
    import h3

    if hasattr(h3, "cell_to_boundary"):
        boundary = h3.cell_to_boundary(cell)
    else:
        boundary = h3.h3_to_geo_boundary(cell)
    return [[round(float(lat), 6), round(float(lng), 6)] for lat, lng in boundary]


def export_market_map(
    *,
    warehouse_path: Path = DEFAULT_WAREHOUSE_PATH,
    export_path: Path = DEFAULT_EXPORT_PATH,
) -> dict[str, Any]:
    """Export H3-cell aggregates from the training mart for the dashboard map.

    Each cell carries real observation counts and medians; cells below
    MIN_CELL_ROWS are excluded rather than smoothed."""
    duckdb = _import_duckdb()

    if not warehouse_path.exists():
        raise FileNotFoundError(
            f"Missing analytics warehouse: {warehouse_path}. Run scripts/build_property_warehouse.py first."
        )

    connection = duckdb.connect(str(warehouse_path), read_only=True)
    try:
        rows = connection.execute(
            f"""
            SELECT
              market_id,
              h3_cell,
              COUNT(*) AS rows,
              ROUND(median(target_value), 0) AS median_value,
              ROUND(median(price_per_sqft), 1) AS median_price_per_sqft,
              ROUND(avg(latitude), 6) AS center_lat,
              ROUND(avg(longitude), 6) AS center_lng
            FROM fact_property_training_mart
            WHERE is_model_ready AND h3_cell IS NOT NULL
            GROUP BY market_id, h3_cell
            HAVING COUNT(*) >= {MIN_CELL_ROWS}
            ORDER BY market_id, h3_cell
            """
        ).fetchall()
    finally:
        connection.close()

    markets: dict[str, Any] = {}
    for market_id, h3_cell, cell_rows, median_value, median_ppsf, center_lat, center_lng in rows:
        market = markets.setdefault(
            market_id,
            {
                "market": market_id,
                "label": MARKET_LABELS.get(market_id, market_id),
                "zoom": MARKET_ZOOM.get(market_id, 11),
                "cells": [],
                "_lat_sum": 0.0,
                "_lng_sum": 0.0,
            },
        )
        market["cells"].append(
            {
                "h3": h3_cell,
                "boundary": _cell_boundary(h3_cell),
                "rows": int(cell_rows),
                "medianValue": float(median_value),
                "medianPricePerSqft": float(median_ppsf),
            }
        )
        market["_lat_sum"] += float(center_lat)
        market["_lng_sum"] += float(center_lng)

    for market in markets.values():
        cell_count = len(market["cells"])
        market["center"] = [
            round(market.pop("_lat_sum") / cell_count, 6),
            round(market.pop("_lng_sum") / cell_count, 6),
        ]
        values = sorted(cell["medianPricePerSqft"] for cell in market["cells"])
        market["pricePerSqftDomain"] = [values[0], values[-1]]

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "fact_property_training_mart (DuckDB analytics warehouse), H3 resolution 8, cells with >= "
        f"{MIN_CELL_ROWS} model-ready observations",
        "markets": markets,
    }

    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_text(json.dumps(payload) + "\n")
    total_cells = sum(len(market["cells"]) for market in markets.values())
    print(f"Wrote {total_cells:,} map cells for {len(markets)} markets to {export_path}")
    return payload


if __name__ == "__main__":
    export_market_map()
