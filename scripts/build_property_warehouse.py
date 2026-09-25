from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

from scripts.identities import attach_identity, duplicate_id_count
from scripts.output_guard import atomic_write_text, env_path, public_storage_ref, refuse_legacy_write, strict_from_env
from scripts.release_store import LINEAGE_LEGACY, content_sha256, snapshot_record


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VANCOUVER_TRAINING_PATH = REPO_ROOT / "data" / "processed" / "vancouver_base_model_training.csv"
DEFAULT_HALIFAX_TRAINING_PATH = REPO_ROOT / "data" / "processed" / "halifax_base_model_training.csv"
DEFAULT_HALIFAX_PERMITS_PATH = REPO_ROOT / "data" / "raw" / "halifax" / "hrm_building_permits_geolocated.csv"
DEFAULT_WAREHOUSE_PATH = env_path(
    "CVH_WAREHOUSE_PATH", REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb"
)
DEFAULT_REPORT_PATH = (
    Path(os.environ["CVH_REPORT_DIR"]) / "analytics_warehouse_report.md"
    if os.environ.get("CVH_REPORT_DIR")
    else REPO_ROOT / "reports" / "analytics_warehouse_report.md"
)
WAREHOUSE_SQL_DIR = REPO_ROOT / "analytics" / "warehouse"
MART_SQL_DIR = WAREHOUSE_SQL_DIR / "marts"

H3_RESOLUTION = 8


def _display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


REQUIRED_VANCOUVER_COLUMNS = [
    "price",
    "logPrice",
    "pricePerSqft",
    "propertyType",
    "postalCode",
    "postalFsa",
    "submarketCluster",
    "livingAreaSqft",
    "bedrooms",
    "bathrooms",
    "latitude",
    "longitude",
    "lat_x_lon",
    "lat_sq",
    "lon_sq",
    "propertyTax",
]

REQUIRED_HALIFAX_COLUMNS = REQUIRED_VANCOUVER_COLUMNS + [
    "ageYears",
    "h3Cell",
    "assessedValue",
    "salePrice",
    "saleDate",
    "timeAdjustmentFactor",
]

MARKET_PROPERTY_TYPES = {
    "vancouver": ["Condo", "Detached", "Townhouse", "Duplex"],
    "halifax_maritimes": ["Detached", "Townhouse", "Duplex"],
}

MIN_HALIFAX_SALE_TO_DWELLING_JOIN_RATE = 0.90


def enforce_quality_gates(checks: list[dict[str, Any]], *, strict: bool) -> list[str]:
    failures: list[str] = []
    for check in checks:
        if check.get("status") != "fail":
            continue
        severity = check.get("severity", "warning")
        message = (
            f"{check.get('check_name')} ({check.get('market_id', 'unknown')}): "
            f"observed={check.get('observed_value')!r}, threshold={check.get('threshold')!r}"
        )
        if severity == "critical":
            failures.append(message)
        elif strict and severity == "warning":
            failures.append(message)
    return failures


@dataclass(frozen=True)
class WarehouseBuildSummary:
    warehouse_path: Path
    report_path: Path
    source_rows: int
    training_mart_rows: int
    model_ready_rows: int
    market_summary_rows: int
    data_quality_checks: list[dict[str, Any]]
    market_rows: dict[str, int] = field(default_factory=dict)
    halifax_permit_rows: int = 0


def _import_duckdb():
    try:
        import duckdb  # type: ignore[import-not-found]
    except ModuleNotFoundError as exc:
        raise RuntimeError("DuckDB is required for the analytics warehouse. Install it with `.venv/bin/pip install duckdb`.") from exc
    return duckdb


def _read_sql(path: Path) -> str:
    return path.read_text()


def _read_training_data(path: Path, required_columns: list[str], market_label: str) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing {market_label} training data: {path}")

    frame = pd.read_csv(path)
    missing_columns = [column for column in required_columns if column not in frame.columns]
    if missing_columns:
        raise ValueError(f"{market_label} training data is missing required columns: {', '.join(missing_columns)}")
    return frame


def _h3_cell(latitude: float, longitude: float) -> str | None:
    try:
        import h3
    except ModuleNotFoundError:
        return None
    if hasattr(h3, "latlng_to_cell"):
        return str(h3.latlng_to_cell(latitude, longitude, H3_RESOLUTION))
    return str(h3.geo_to_h3(latitude, longitude, H3_RESOLUTION))


def _ensure_h3_column(frame: pd.DataFrame) -> pd.DataFrame:
    """The Vancouver extract predates the H3 feature work; derive cells from
    coordinates at build time so both markets share the location encoding."""
    if "h3Cell" in frame.columns and frame["h3Cell"].notna().any():
        return frame

    frame = frame.copy()
    frame["h3Cell"] = [
        _h3_cell(latitude, longitude) if pd.notna(latitude) and pd.notna(longitude) else None
        for latitude, longitude in zip(frame["latitude"], frame["longitude"])
    ]
    return frame


def _quality_rows(frame: pd.DataFrame, market_id: str) -> list[dict[str, Any]]:
    row_count = len(frame)
    ready_mask = (
        frame["price"].between(100_000, 10_000_000)
        & frame["livingAreaSqft"].between(250, 10_000)
        & frame["bedrooms"].between(0, 10)
        & frame["bathrooms"].between(0, 10)
        & frame["propertyType"].isin(MARKET_PROPERTY_TYPES[market_id])
    )

    checks = [
        {
            "check_name": "source_rows_present",
            "market_id": market_id,
            "severity": "critical",
            "observed_value": float(row_count),
            "threshold": "> 0 rows",
            "status": "pass" if row_count > 0 else "fail",
            "notes": f"Processed {market_id} training rows loaded into the warehouse.",
        },
        {
            "check_name": "model_ready_rows",
            "market_id": market_id,
            "severity": "critical",
            "observed_value": float(ready_mask.sum()),
            "threshold": "> 0 rows",
            "status": "pass" if int(ready_mask.sum()) > 0 else "fail",
            "notes": "Rows satisfy basic price, size, room-count, and property-type checks.",
        },
        {
            "check_name": "postal_fsa_completeness",
            "market_id": market_id,
            "severity": "critical" if market_id == "halifax_maritimes" else "warning",
            "observed_value": float(frame["postalFsa"].notna().mean() if row_count else 0),
            "threshold": ">= 0.95",
            "status": "pass" if row_count and frame["postalFsa"].notna().mean() >= 0.95 else "fail",
            "notes": "FSA completeness supports local market summaries and geospatial grouping.",
        },
    ]

    if market_id == "vancouver":
        checks.append(
            {
                "check_name": "property_tax_completeness",
                "market_id": market_id,
                "severity": "info",
                "observed_value": float(frame["propertyTax"].notna().mean() if row_count else 0),
                "threshold": "tracked only",
                "status": "pass",
                "notes": "Property tax is useful context but not required for model readiness.",
            }
        )

    if market_id == "halifax_maritimes":
        checks.append(
            {
                "check_name": "assessed_value_completeness",
                "market_id": market_id,
                "severity": "info",
                "observed_value": float(frame["assessedValue"].notna().mean() if row_count else 0),
                "threshold": "tracked only",
                "status": "pass",
                "notes": "Assessed value provides market context and a sale-vs-assessment sanity signal.",
            }
        )
        checks.append(
            {
                "check_name": "time_adjustment_within_guardrail",
                "market_id": market_id,
                "severity": "critical",
                "observed_value": float(frame["timeAdjustmentFactor"].between(0.5, 2.0).mean() if row_count else 0),
                "threshold": ">= 0.99",
                "status": "pass" if row_count and frame["timeAdjustmentFactor"].between(0.5, 2.0).mean() >= 0.99 else "fail",
                "notes": "Sale-price time adjustments stay inside the same guardrail used by the market freshness multiplier.",
            }
        )

        return checks

    duplicate_rows = duplicate_id_count(frame["propertyObservationId"]) if "propertyObservationId" in frame.columns else 0
    checks.append(
        {
            "check_name": "observation_id_unique",
            "market_id": market_id,
            "severity": "info",
            "value_kind": "count",
            "observed_value": float(duplicate_rows),
            "threshold": "0 duplicate observation ids",
            "status": "fail" if duplicate_rows else "pass",
            "notes": (
                "Duplicate ids are retained and block a validated release. "
                "A listing-row or processed-row fingerprint is not a durable property id."
            ),
        }
    )
    return checks


def _identity_contracts(frame: pd.DataFrame, market_id: str) -> list[dict[str, Any]]:
    missing = int(frame["propertyObservationId"].map(lambda value: value is None or str(value).strip() == "").sum())
    duplicates = duplicate_id_count(frame["propertyObservationId"])
    kind = str(frame["identityKind"].iloc[0]) if len(frame) else "none"
    return [
        {
            "name": f"{market_id}.observation_id_present",
            "severity": "hard",
            "status": "fail" if missing else "pass",
            "observed": missing,
            "detail": "Every mart row needs an observation id.",
        },
        {
            "name": f"{market_id}.observation_id_unique",
            "severity": "hard",
            "status": "fail" if duplicates else "pass",
            "observed": duplicates,
            "detail": (
                f"identityKind={kind}. Duplicate fingerprints stay in the candidate and fail publication. "
                "Vancouver hashes are listing-row fingerprints, not durable property ids."
            ),
        },
    ]


def _record_processed_snapshots(entries: list[tuple[str, Path, pd.DataFrame, str]]) -> None:
    """Attach input fingerprints to the open candidate. Content hash excludes fetch time."""
    root = os.environ.get("CVH_CANDIDATE_ROOT")
    if not root:
        return
    manifest_path = Path(root) / "manifest.json"
    if not manifest_path.is_file():
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    snapshots = manifest.setdefault("snapshots", [])
    for name, path, frame, notes in entries:
        if not path.is_file():
            continue
        snapshots.append(
            snapshot_record(
                name=name,
                lineage_class=LINEAGE_LEGACY,
                content_sha256=content_sha256(path),
                storage_ref=public_storage_ref(path),
                row_count=int(len(frame)),
                schema=[str(column) for column in pd.read_csv(path, nrows=0).columns],
                source_identity="committed processed extract",
                notes=notes,
            )
        )
    atomic_write_text(manifest_path, json.dumps(manifest, indent=2) + "\n")


def _scalar(connection: Any, sql: str) -> int:
    value = connection.execute(sql).fetchone()[0]
    return int(value or 0)


def build_property_warehouse(
    *,
    vancouver_training_path: Path = DEFAULT_VANCOUVER_TRAINING_PATH,
    halifax_training_path: Path = DEFAULT_HALIFAX_TRAINING_PATH,
    halifax_permits_path: Path = DEFAULT_HALIFAX_PERMITS_PATH,
    warehouse_path: Path = DEFAULT_WAREHOUSE_PATH,
    report_path: Path = DEFAULT_REPORT_PATH,
    strict: bool = False,
) -> WarehouseBuildSummary:
    duckdb = _import_duckdb()

    vancouver_frame = attach_identity(
        _ensure_h3_column(_read_training_data(vancouver_training_path, REQUIRED_VANCOUVER_COLUMNS, "Vancouver")),
        "vancouver",
    )
    quality_rows = _quality_rows(vancouver_frame, "vancouver")
    contract_checks = _identity_contracts(vancouver_frame, "vancouver")
    contract_checks.append(
        {
            "name": "vancouver.raw_lineage",
            "severity": "hard",
            "status": "not_applicable",
            "observed": None,
            "detail": (
                "The processed Vancouver extract has no source listing id and no listing date. "
                "A validated raw-backed release is blocked until those snapshots exist. "
                "The listing-row fingerprint is not a durable property id."
            ),
        }
    )

    halifax_frame: pd.DataFrame | None = None
    if halifax_training_path.exists():
        halifax_frame = attach_identity(
            _read_training_data(halifax_training_path, REQUIRED_HALIFAX_COLUMNS, "Halifax"),
            "halifax_maritimes",
        )
        quality_rows.extend(_quality_rows(halifax_frame, "halifax_maritimes"))
        contract_checks.extend(_identity_contracts(halifax_frame, "halifax_maritimes"))
        contract_checks.append(
            {
                "name": "halifax_maritimes.sale_to_dwelling_join",
                "severity": "hard",
                "status": "not_applicable",
                "observed": None,
                "numeratorName": "window_sales_after_latest_per_aan_inner_joined_to_dwellings",
                "denominatorName": "latest_sale_per_aan_in_training_window",
                "threshold": 0.90,
                "detail": (
                    "Raw PVSC snapshots are not in this checkout, so the join was not remeasured. "
                    "The committed summary stores saleToDwellingJoin=0.7715 beside joinedToDwellings=18268 "
                    "and windowSales=25160; 18268/25160 = 0.726073 (about 72.61%), so that rate field is internally "
                    "inconsistent. The 0.90 publication threshold was not lowered."
                ),
            }
        )
    else:
        message = f"Halifax training extract not found at {halifax_training_path}; building Vancouver-only warehouse."
        print(f"WARNING: {message}")
        if strict:
            raise RuntimeError(message)

    snapshot_entries = [
        (
            "vancouver_processed_training_csv",
            vancouver_training_path,
            vancouver_frame,
            "Legacy processed Vancouver listing extract. No source listing id or listing date is in this file. The listing-row fingerprint is not a durable property id, and raw lineage is not recovered.",
        )
    ]
    if halifax_frame is not None:
        snapshot_entries.append(
            (
                "halifax_processed_training_csv",
                halifax_training_path,
                halifax_frame,
                "Legacy processed Halifax extract. Account number aan was not retained in this CSV, so sale identity is a processed-row fingerprint. Raw PVSC bytes are not in this checkout.",
            )
        )
    _record_processed_snapshots(snapshot_entries)

    warehouse_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    partial_warehouse = warehouse_path.with_name(warehouse_path.name + ".partial")
    if partial_warehouse.exists():
        partial_warehouse.unlink()

    connection = duckdb.connect(str(partial_warehouse))
    try:
        connection.execute(_read_sql(WAREHOUSE_SQL_DIR / "schema.sql"))

        connection.register("vancouver_training_source", vancouver_frame)
        connection.execute("CREATE OR REPLACE TABLE stg_vancouver_listings AS SELECT * FROM vancouver_training_source")

        connection.execute(_read_sql(MART_SQL_DIR / "fact_property_training_mart.sql"))
        connection.execute(_read_sql(MART_SQL_DIR / "fact_property_training_mart_insert_vancouver.sql"))

        if halifax_frame is not None:
            connection.register("halifax_training_source", halifax_frame)
            connection.execute(
                "CREATE OR REPLACE TABLE stg_halifax_properties AS SELECT * FROM halifax_training_source"
            )
            connection.execute(_read_sql(MART_SQL_DIR / "fact_property_training_mart_insert_halifax.sql"))

        halifax_permit_rows = 0
        if halifax_permits_path.exists():
            permits_frame = pd.read_csv(halifax_permits_path, low_memory=False)
            connection.register("halifax_permits_source", permits_frame)
            connection.execute("CREATE OR REPLACE TABLE stg_halifax_permits AS SELECT * FROM halifax_permits_source")
            halifax_permit_rows = len(permits_frame)
        else:
            # Permits live under gitignored data/raw; public/CI checkouts skip staging.
            print(
                f"WARNING: HRM permits file not found at {_display_path(halifax_permits_path)}; "
                "skipping permit staging."
            )

        connection.execute(_read_sql(MART_SQL_DIR / "fact_market_feature_summary.sql"))

        quality_frame = pd.DataFrame(quality_rows)
        connection.register("quality_check_source", quality_frame)
        connection.execute("CREATE OR REPLACE TABLE fact_data_quality_checks AS SELECT * FROM quality_check_source")

        market_rows = {
            market_id: count
            for market_id, count in connection.execute(
                "SELECT market_id, COUNT(*) FROM fact_property_training_mart GROUP BY market_id"
            ).fetchall()
        }

        summary = WarehouseBuildSummary(
            warehouse_path=warehouse_path,
            report_path=report_path,
            source_rows=len(vancouver_frame) + (len(halifax_frame) if halifax_frame is not None else 0),
            training_mart_rows=_scalar(connection, "SELECT COUNT(*) FROM fact_property_training_mart"),
            model_ready_rows=_scalar(connection, "SELECT COUNT(*) FROM fact_property_training_mart WHERE is_model_ready"),
            market_summary_rows=_scalar(connection, "SELECT COUNT(*) FROM fact_market_feature_summary"),
            data_quality_checks=quality_rows,
            market_rows=market_rows,
            halifax_permit_rows=halifax_permit_rows,
        )
    finally:
        connection.close()

    gate_failures = enforce_quality_gates(quality_rows, strict=strict)
    if gate_failures:
        partial_warehouse.unlink(missing_ok=True)
        details = "; ".join(gate_failures)
        raise RuntimeError(f"Warehouse quality gates failed ({'strict' if strict else 'critical'}): {details}")

    os.replace(partial_warehouse, warehouse_path)
    Path(str(partial_warehouse) + ".wal").unlink(missing_ok=True)
    contracts_path = os.environ.get("CVH_CONTRACTS_PATH")
    if contracts_path:
        atomic_write_text(Path(contracts_path), json.dumps({"checks": contract_checks}, indent=2) + "\n")
    write_warehouse_report(summary)
    return summary


def write_warehouse_report(summary: WarehouseBuildSummary) -> Path:
    lines = [
        "# Analytics Warehouse Report",
        "",
        "Warehouse: `warehouse/property_analytics.duckdb`",
        "",
        "## Build Summary",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| source rows (all markets) | {summary.source_rows:,} |",
        f"| property training mart rows | {summary.training_mart_rows:,} |",
        f"| model-ready rows | {summary.model_ready_rows:,} |",
        f"| market feature summary rows | {summary.market_summary_rows:,} |",
    ]

    for market_id, rows in sorted(summary.market_rows.items()):
        lines.append(f"| {market_id} mart rows | {rows:,} |")
    if summary.halifax_permit_rows:
        lines.append(f"| staged HRM permit rows | {summary.halifax_permit_rows:,} |")

    lines.extend(
        [
            "",
            "## Data Quality Checks",
            "",
            "| Check | Market | Severity | Observed | Threshold | Status |",
            "|---|---|---|---:|---|---|",
        ]
    )

    for check in summary.data_quality_checks:
        observed = check["observed_value"]
        if check.get("value_kind") == "count":
            observed_text = f"{observed:,.0f}"
        elif check.get("value_kind") == "rate":
            observed_text = f"{observed:.2%}"
        else:
            observed_text = f"{observed:.2%}" if 0 <= observed <= 1 else f"{observed:,.0f}"
        lines.append(
            f"| {check['check_name']} | {check.get('market_id', 'vancouver')} | {check['severity']} "
            f"| {observed_text} | {check['threshold']} | {check['status']} |"
        )

    lines.extend(
        [
            "",
            "## Why This Matters",
            "",
            "- The project now has a database-backed training mart shape instead of only ad hoc CSV consumption.",
            "- Vancouver (listing-price target) and Halifax (HRM) (time-adjusted real sale-price target) share one model-ready contract.",
            "- The mart separates source lineage, data readiness, market summaries, and model-ready observations.",
            "- The next modelling step is to compare local Vancouver, local Halifax, pooled, and hybrid models on the same feature contract.",
            "",
        ]
    )

    atomic_write_text(summary.report_path, "\n".join(lines))
    return summary.report_path


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Build the analytics property warehouse.")
    parser.add_argument(
        "--strict",
        action=argparse.BooleanOptionalAction,
        default=strict_from_env(False),
        help="Fail on critical quality checks, and on warnings when strict. CVH_STRICT=0 or 1 overrides the CI default.",
    )
    parser.add_argument("--warehouse", default=None)
    parser.add_argument("--report", default=None)
    cli_args = parser.parse_args()
    warehouse_path = Path(cli_args.warehouse) if cli_args.warehouse else DEFAULT_WAREHOUSE_PATH
    report_path = Path(cli_args.report) if cli_args.report else DEFAULT_REPORT_PATH
    refuse_legacy_write(warehouse_path)
    refuse_legacy_write(report_path)

    build_summary = build_property_warehouse(
        warehouse_path=warehouse_path,
        report_path=report_path,
        strict=cli_args.strict,
    )
    print(f"Wrote {build_summary.warehouse_path}")
    print(f"Wrote {build_summary.report_path}")
    for market, rows in sorted(build_summary.market_rows.items()):
        print(f"{market}: {rows:,} mart rows")
