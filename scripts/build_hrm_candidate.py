"""Build one HRM raw-evidence candidate. Does not select it as the product release.

The product pointer at data/releases/current.json is left unchanged. Pass an
isolated --releases-root to publish a candidate whose HRM data checks passed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.build_all import BuildStep, production_steps, run_build
from scripts.identities import assign_sale_identity
from scripts.output_guard import public_storage_ref
from scripts.release_store import (
    LINEAGE_RAW,
    content_sha256,
    open_candidate,
    publish_candidate,
    read_pointer,
    snapshot_record,
)
from scripts.setup_halifax_data import (
    DEFAULT_ASSESSMENTS_PATH,
    DEFAULT_CIVIC_ADDRESSES_PATH,
    DEFAULT_DWELLINGS_PATH,
    DEFAULT_PERMITS_PATH,
    DEFAULT_SALES_PATH,
    build_training_extract,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCT_RELEASES = REPO_ROOT / "data" / "releases"


def _raw_paths() -> dict[str, Path]:
    return {
        "pvsc_dwellings": Path(DEFAULT_DWELLINGS_PATH),
        "pvsc_sales": Path(DEFAULT_SALES_PATH),
        "pvsc_assessments": Path(DEFAULT_ASSESSMENTS_PATH),
        "hrm_civic_addresses": Path(DEFAULT_CIVIC_ADDRESSES_PATH),
        "hrm_permits": Path(DEFAULT_PERMITS_PATH),
    }


def _record_raw_snapshots(candidate, filters: dict[str, str]) -> None:
    import pandas as pd

    for name, path in _raw_paths().items():
        if not path.is_file():
            continue
        header = list(pd.read_csv(path, nrows=0).columns)
        candidate.add_snapshot(
            snapshot_record(
                name=name,
                lineage_class=LINEAGE_RAW,
                content_sha256=content_sha256(path),
                storage_ref=public_storage_ref(path),
                schema=header,
                retrieval_filters=filters.get(name),
                fetched_at=None,
                source_updated_at=None,
                notes=(
                    "New open-data snapshot acquired in this environment. "
                    "Not a recovery of the July processed extract. "
                    "fetchedAt and sourceUpdatedAt are filled by the acquisition manifest when it exists."
                ),
            )
        )


def _apply_acquisition_manifest(candidate) -> None:
    manifest_path = REPO_ROOT / "data" / "raw" / "halifax" / "acquisition_manifest.json"
    if not manifest_path.is_file():
        return
    acquired = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_name = {row["name"]: row for row in acquired.get("snapshots", [])}
    for row in candidate.manifest.get("snapshots", []):
        extra = by_name.get(row["name"])
        if not extra:
            continue
        row["ingestion"] = {
            "fetchedAt": extra.get("fetchedAt"),
            "sourceUpdatedAt": extra.get("sourceUpdatedAt"),
        }
        row["sourceObservationPeriod"] = extra.get("sourceObservationPeriod")
        row["rowCount"] = extra.get("rowCount")
    candidate._save()


def trace_evidence(warehouse_path: Path, extract_path: Path) -> dict:
    import duckdb
    import pandas as pd

    connection = duckdb.connect(str(warehouse_path), read_only=True)
    try:
        row = connection.execute(
            """
            SELECT postal_fsa, property_type, COUNT(*) AS n, median(target_value) AS med
            FROM fact_property_training_mart
            WHERE market_id = 'halifax_maritimes' AND is_model_ready
            GROUP BY 1, 2
            ORDER BY n DESC
            LIMIT 1
            """
        ).fetchone()
        if row is None:
            return {"status": "no_model_ready_rows"}
        fsa, property_type, row_count, median_value = row
        identifiers = [
            value
            for (value,) in connection.execute(
                """
                SELECT source_observation_id
                FROM fact_property_training_mart
                WHERE market_id = 'halifax_maritimes'
                  AND postal_fsa = ?
                  AND property_type = ?
                  AND is_model_ready
                ORDER BY source_observation_id
                """,
                [fsa, property_type],
            ).fetchall()
        ]
    finally:
        connection.close()

    extract = pd.read_csv(extract_path, usecols=["saleObservationId", "postalFsa", "propertyType", "price"])
    matched = extract[extract["saleObservationId"].isin(identifiers)]
    return {
        "postalFsa": fsa,
        "propertyType": property_type,
        "martRows": int(row_count),
        "medianTarget": None if median_value is None else float(median_value),
        "sourceRowsWithThoseIds": int(len(matched)),
        "everyMartIdFoundInExtract": set(identifiers) <= set(matched["saleObservationId"].astype(str)),
        "sampleSourceObservationIds": [str(value) for value in identifiers[:5]],
    }


def shuffled_extract_matches(reference_summary: dict, reference_extract: Path, work_dir: Path, reference_date: str) -> dict:
    import pandas as pd

    shuffled_dir = work_dir / "shuffled-inputs"
    shuffled_dir.mkdir(parents=True, exist_ok=True)
    renamed = {
        "dwellings_path": "pvsc_dwelling_characteristics_hrm.csv",
        "sales_path": "pvsc_parcel_sales_hrm.csv",
        "assessments_path": "pvsc_assessed_values_hrm.csv",
        "civic_addresses_path": "hrm_civic_addresses.csv",
    }
    sources = {
        "dwellings_path": Path(DEFAULT_DWELLINGS_PATH),
        "sales_path": Path(DEFAULT_SALES_PATH),
        "assessments_path": Path(DEFAULT_ASSESSMENTS_PATH),
        "civic_addresses_path": Path(DEFAULT_CIVIC_ADDRESSES_PATH),
    }
    kwargs = {}
    for key, source in sources.items():
        frame = pd.read_csv(source, low_memory=False)
        destination = shuffled_dir / renamed[key]
        frame.sample(frac=1, random_state=19).to_csv(destination, index=False)
        kwargs[key] = destination
    second = build_training_extract(
        output_path=work_dir / "shuffled_training.csv",
        summary_path=work_dir / "shuffled_summary.json",
        strict=False,
        reference_date=reference_date,
        **kwargs,
    )
    original = pd.read_csv(reference_extract, usecols=["saleObservationId", "accountId", "postalFsa", "propertyType", "price"])
    replayed = pd.read_csv(work_dir / "shuffled_training.csv", usecols=["saleObservationId", "accountId", "postalFsa", "propertyType", "price"])
    original_keys = original.sort_values("saleObservationId").reset_index(drop=True)
    replay_keys = replayed.sort_values("saleObservationId").reset_index(drop=True)
    return {
        "logicalKeysMatch": original_keys["saleObservationId"].tolist() == replay_keys["saleObservationId"].tolist(),
        "accountIdsMatch": original_keys["accountId"].tolist() == replay_keys["accountId"].tolist(),
        "pricesMatch": original_keys["price"].tolist() == replay_keys["price"].tolist(),
        "joinRateMatch": reference_summary["joinAudit"]["measuredRate"] == second["joinAudit"]["measuredRate"],
        "rowCount": int(len(original)),
    }


def replay_sale_identity(sales_path: Path) -> dict:
    import pandas as pd

    sales = pd.read_csv(sales_path, low_memory=False)
    sales["sale_date"] = pd.to_datetime(sales["sale_date"], errors="coerce")
    sales = sales.dropna(subset=["sale_date", "sale_price", "aan"])
    first = assign_sale_identity(sales)
    shuffled = assign_sale_identity(sales.sample(frac=1, random_state=11))
    return {
        "rows": int(len(first)),
        "identityKind": sorted({str(value) for value in first["identityKind"].dropna().unique()}),
        "crossSnapshotMatch": sorted({str(value) for value in first["crossSnapshotMatch"].dropna().unique()}),
        "unique": bool(first["saleObservationId"].is_unique),
        "shuffleMatches": sorted(first["saleObservationId"]) == sorted(shuffled["saleObservationId"]),
        "accountRepeats": int(first["accountId"].duplicated().sum()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--releases-root", required=True, type=Path)
    parser.add_argument("--reference-date", required=True)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--release-id", default="hrm-raw-evidence")
    args = parser.parse_args()
    releases_root = args.releases_root.resolve()
    if releases_root == PRODUCT_RELEASES.resolve():
        raise SystemExit("Refusing to use the product release root. Pass an isolated --releases-root.")

    product_pointer_before = (PRODUCT_RELEASES / "current.json").read_bytes()
    candidate = open_candidate(
        releases_root,
        lineage_class=LINEAGE_RAW,
        profile_id="hrm_raw_evidence",
        release_id=args.release_id,
        reference_date=args.reference_date,
        raw_lineage_recovered=True,
        notes="Scoped HRM raw-evidence candidate. Vancouver and fitted models are outside this claim.",
    )
    filters = {
        "pvsc_dwellings": "municipal_unit='HALIFAX REGIONAL MUNICIPALITY (HRM)'",
        "pvsc_sales": "municipal_unit HRM, sale_date>=2015-01-01, parcels_in_sale=1, sale_price>10000",
        "pvsc_assessments": "municipal_unit HRM, tax_year>=2025",
        "hrm_civic_addresses": "ArcGIS CivicAddresses where 1=1",
        "hrm_permits": "ArcGIS PPLC_Permits_Geolocated where 1=1",
    }
    _record_raw_snapshots(candidate, filters)
    _apply_acquisition_manifest(candidate)

    staging = candidate.root / "staging"
    staging.mkdir(parents=True, exist_ok=True)
    extract_path = staging / "halifax_training.csv"
    summary_path = staging / "halifax_summary.json"
    summary = build_training_extract(
        output_path=extract_path,
        summary_path=summary_path,
        strict=True,
        reference_date=args.reference_date,
    )
    audit_path = candidate.root / "reports" / "join_audit.json"
    audit_path.write_text(json.dumps(summary["joinAudit"], indent=2) + "\n", encoding="utf-8")
    replay = replay_sale_identity(Path(DEFAULT_SALES_PATH))
    (candidate.root / "reports" / "replay.json").write_text(json.dumps(replay, indent=2) + "\n", encoding="utf-8")

    os.environ["CVH_HALIFAX_TRAINING_PATH"] = str(extract_path)
    os.environ["CVH_WAREHOUSE_MARKETS"] = "halifax_maritimes"
    os.environ["CVH_JOIN_AUDIT_PATH"] = str(audit_path)
    os.environ["CVH_REFERENCE_DATE"] = args.reference_date
    wanted = {"analytics warehouse", "market evidence export"}
    steps = [step for step in production_steps(candidate.root) if step.name in wanted]
    for index, step in enumerate(steps):
        if step.name == "analytics warehouse":
            steps[index] = BuildStep(
                name=step.name,
                script=step.script,
                inputs=(extract_path,),
                outputs=step.outputs,
                required=True,
            )
    code = run_build(steps, strict=True, candidate=candidate)
    if (PRODUCT_RELEASES / "current.json").read_bytes() != product_pointer_before:
        raise SystemExit("Product current.json changed. This script must not select a release.")
    if code != 0:
        return code
    warehouse = candidate.root / "warehouse" / "property_analytics.duckdb"
    trace = trace_evidence(warehouse, extract_path)
    (candidate.root / "reports" / "lineage_trace.json").write_text(json.dumps(trace, indent=2) + "\n", encoding="utf-8")
    shuffle_report = shuffled_extract_matches(summary, extract_path, staging / "replay", args.reference_date)
    (candidate.root / "reports" / "shuffle_replay.json").write_text(
        json.dumps(shuffle_report, indent=2) + "\n", encoding="utf-8"
    )
    if args.publish:
        publish_candidate(candidate)
        if (PRODUCT_RELEASES / "current.json").read_bytes() != product_pointer_before:
            raise SystemExit("Product current.json changed during isolated publication.")
        pointer = read_pointer(releases_root)
        print(json.dumps({"isolatedPointer": pointer, "productUntouched": True}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        product = PRODUCT_RELEASES / "current.json"
        print(f"HRM candidate stopped: {error}", file=sys.stderr)
        if product.is_file():
            print(f"Product pointer still {product}", file=sys.stderr)
        raise
