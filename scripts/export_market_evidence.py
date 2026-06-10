from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WAREHOUSE_PATH = REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb"
DEFAULT_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "market_evidence.json"

# Keep the export honest: only segments with enough observations to summarize.
MIN_SEGMENT_ROWS = 5


def _import_duckdb():
    try:
        import duckdb  # type: ignore[import-not-found]
    except ModuleNotFoundError as exc:
        raise RuntimeError("DuckDB is required to export market evidence. Install it with `.venv/bin/pip install duckdb`.") from exc
    return duckdb


def _clean_number(value: Any) -> float | None:
    if value is None:
        return None
    number = float(value)
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def export_market_evidence(
    *,
    warehouse_path: Path = DEFAULT_WAREHOUSE_PATH,
    export_path: Path = DEFAULT_EXPORT_PATH,
) -> dict[str, Any]:
    """Export fact_market_feature_summary to the committed JSON consumed by the
    API evidence endpoint (shape: marketEvidenceFileSchema in artifacts/shared)."""
    duckdb = _import_duckdb()

    if not warehouse_path.exists():
        raise FileNotFoundError(
            f"Missing analytics warehouse: {warehouse_path}. Run scripts/build_property_warehouse.py first."
        )

    connection = duckdb.connect(str(warehouse_path), read_only=True)
    try:
        markets = [
            {"marketId": market_id, "label": market_name, "region": province_state}
            for market_id, market_name, province_state in connection.execute(
                """
                SELECT DISTINCT m.market_id, m.market_name, m.province_state
                FROM dim_market m
                JOIN fact_property_training_mart f ON f.market_id = m.market_id
                ORDER BY m.market_id
                """
            ).fetchall()
        ]

        source_datasets = [
            {"id": dataset_id, "market": market_id, "name": source_name}
            for dataset_id, market_id, source_name in connection.execute(
                """
                SELECT source_dataset_id, market_id, source_name
                FROM dim_source_dataset
                WHERE availability_status IN ('available', 'available locally')
                ORDER BY source_dataset_id
                """
            ).fetchall()
        ]

        summary_rows = connection.execute(
            f"""
            SELECT
              market_id,
              city_name,
              province_state,
              property_type,
              postal_fsa,
              training_rows,
              model_ready_rows,
              median_target_value,
              avg_target_value,
              median_price_per_sqft,
              avg_living_area_sqft,
              avg_bedrooms,
              avg_bathrooms
            FROM fact_market_feature_summary
            WHERE postal_fsa IS NOT NULL AND training_rows >= {MIN_SEGMENT_ROWS}
            ORDER BY market_id, postal_fsa, property_type
            """
        ).fetchall()
    finally:
        connection.close()

    rows = [
        {
            "marketId": market_id,
            "cityName": city_name,
            "provinceState": province_state,
            "propertyType": property_type,
            "postalFsa": postal_fsa,
            "trainingRows": int(training_rows),
            "modelReadyRows": int(model_ready_rows),
            "medianValue": _clean_number(median_value),
            "avgValue": _clean_number(avg_value),
            "medianPricePerSqft": _clean_number(median_price_per_sqft),
            "avgLivingAreaSqft": _clean_number(avg_living_area),
            "avgBedrooms": _clean_number(avg_bedrooms),
            "avgBathrooms": _clean_number(avg_bathrooms),
        }
        for (
            market_id,
            city_name,
            province_state,
            property_type,
            postal_fsa,
            training_rows,
            model_ready_rows,
            median_value,
            avg_value,
            median_price_per_sqft,
            avg_living_area,
            avg_bedrooms,
            avg_bathrooms,
        ) in summary_rows
    ]

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "provenance": {
            "warehousePath": str(warehouse_path.relative_to(REPO_ROOT) if warehouse_path.is_relative_to(REPO_ROOT) else warehouse_path),
            "builtFrom": "fact_market_feature_summary (DuckDB analytics warehouse)",
            "sourceDatasets": source_datasets,
        },
        "markets": markets,
        "rows": rows,
    }

    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {len(rows):,} evidence rows for {len(markets)} markets to {export_path}")
    return payload


if __name__ == "__main__":
    export_market_evidence()
