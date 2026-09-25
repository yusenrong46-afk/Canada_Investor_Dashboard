from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"
RAW_HALIFAX_DIR = REPO_ROOT / "data" / "raw" / "halifax"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"


@dataclass(frozen=True)
class BuildStep:
    name: str
    script: Path
    args: tuple[str, ...] = ()
    inputs: tuple[Path, ...] = ()
    outputs: tuple[Path, ...] = ()
    required: bool = False
    depends_on: tuple[str, ...] = ()
    output_validators: tuple[Callable[[Path], str], ...] = ()
    mutates: tuple[str, ...] = ()


def _step_slug(name: str) -> str:
    slug = "".join(character if character.isalnum() else "-" for character in name.lower())
    return "-".join(part for part in slug.split("-") if part)


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _validate_output(output: Path) -> str:
    if not output.exists():
        return f"missing output: {_display_path(output)}"
    if output.stat().st_size <= 0:
        return f"empty output: {_display_path(output)}"
    if output.suffix.lower() == ".json":
        try:
            json.loads(output.read_text(encoding="utf-8"))
        except Exception as error:
            return f"invalid json output: {_display_path(output)} ({error})"
    return ""


def production_steps(candidate_root: Path) -> list[BuildStep]:
    """Output paths for one candidate directory. Nothing here points at published files."""
    exports = candidate_root / "exports"
    reports = candidate_root / "reports"
    warehouse = candidate_root / "warehouse" / "property_analytics.duckdb"
    return [
        BuildStep(
            name="analytics warehouse",
            script=SCRIPTS_DIR / "build_property_warehouse.py",
            inputs=(PROCESSED_DIR / "vancouver_base_model_training.csv",),
            outputs=(warehouse, reports / "analytics_warehouse_report.md"),
            required=True,
        ),
        BuildStep(
            name="market trend (NHPI)",
            script=SCRIPTS_DIR / "build_market_trend.py",
            inputs=(REPO_ROOT / "data" / "raw" / "market" / "18100205.csv",),
            outputs=(exports / "market_trend.json",),
            required=False,
            mutates=("warehouse/property_analytics.duckdb",),
        ),
        BuildStep(
            name="market evidence export",
            script=SCRIPTS_DIR / "export_market_evidence.py",
            inputs=(warehouse,),
            outputs=(exports / "market_evidence.json",),
            required=True,
            depends_on=("analytics warehouse",),
        ),
        BuildStep(
            name="market map export",
            script=SCRIPTS_DIR / "export_market_map.py",
            inputs=(warehouse,),
            outputs=(exports / "market_map.json",),
            required=True,
            depends_on=("analytics warehouse",),
        ),
        BuildStep(
            name="halifax renovation uplift",
            script=SCRIPTS_DIR / "build_halifax_uplift.py",
            inputs=(
                RAW_HALIFAX_DIR / "hrm_building_permits_geolocated.csv",
                PROCESSED_DIR / "halifax_base_model_training.csv",
            ),
            outputs=(exports / "halifax_uplift.json",),
            required=False,
        ),
        BuildStep(
            name="model experiment lab",
            script=SCRIPTS_DIR / "run_model_experiments.py",
            inputs=(warehouse,),
            outputs=(exports / "model_experiments.json", reports / "model_experiments_report.md"),
            required=True,
            depends_on=("analytics warehouse",),
            mutates=("warehouse/property_analytics.duckdb",),
        ),
        BuildStep(
            name="model metrics report",
            script=SCRIPTS_DIR / "generate_model_report.py",
            inputs=(PROCESSED_DIR / "vancouver_base_model_summary.json",),
            outputs=(reports / "model_metrics_report.md",),
            required=True,
        ),
        BuildStep(
            name="data quality report",
            script=SCRIPTS_DIR / "generate_data_quality_report.py",
            inputs=(PROCESSED_DIR / "vancouver_base_model_training.csv",),
            outputs=(reports / "data_quality_report.md",),
            required=True,
        ),
    ]


def run_build(
    steps: list[BuildStep] | None = None,
    *,
    strict: bool = False,
    candidate: Any | None = None,
) -> int:
    """Run pipeline steps in order. With --strict, required steps must finish with valid outputs.

    A failed step is recorded and every later step that depends on it is not executed.
    ``CVH_STRICT`` is passed explicitly to child processes.
    """
    if steps is None:
        raise ValueError("run_build requires an explicit step list from production_steps(candidate.root)")
    results: list[tuple[str, str, str]] = []
    failed_steps: set[str] = set()
    child_env = os.environ.copy()
    child_env["CVH_STRICT"] = "1" if strict else "0"
    if candidate is not None:
        child_env["CVH_CANDIDATE_ROOT"] = str(candidate.root)
        child_env["CVH_BUILD_ID"] = candidate.build_id
        child_env["CVH_WAREHOUSE_PATH"] = str(candidate.root / "warehouse" / "property_analytics.duckdb")
        child_env["CVH_EXPORT_DIR"] = str(candidate.root / "exports")
        child_env["CVH_REPORT_DIR"] = str(candidate.root / "reports")
        child_env["CVH_CONTRACTS_PATH"] = str(candidate.root / "contracts.json")
        if candidate.reference_date:
            child_env["CVH_REFERENCE_DATE"] = candidate.reference_date

    for step in steps:
        blocked_by = [name for name in step.depends_on if name in failed_steps]
        if blocked_by:
            failed_steps.add(step.name)
            status = "FAILED" if strict and step.required else "BLOCKED"
            results.append((step.name, status, "blocked by failed step: " + ", ".join(blocked_by)))
            continue

        if not step.script.exists():
            reason = f"script not present: {_display_path(step.script)}"
            print(f"\n== {step.name}: SKIPPED ({reason})")
            status = "FAILED" if strict and step.required else "SKIPPED"
            if status == "FAILED":
                failed_steps.add(step.name)
            results.append((step.name, status, reason))
            continue

        missing = [_display_path(path) for path in step.inputs if not path.exists()]
        if missing:
            reason = "missing inputs: " + ", ".join(missing)
            print(f"\n== {step.name}: SKIPPED ({reason})")
            status = "FAILED" if strict and step.required else "SKIPPED"
            if status == "FAILED":
                failed_steps.add(step.name)
            results.append((step.name, status, reason))
            continue

        receipt_path = None
        if candidate is not None:
            receipt_path = candidate.root / "receipts" / f"{_step_slug(step.name)}.json"
            child_env["CVH_RECEIPT_PATH"] = str(receipt_path)
            candidate.begin_step(step.name, list(step.outputs))

        command = [sys.executable, str(step.script), *step.args]
        print(f"\n== {step.name}: running {_display_path(step.script)} {' '.join(step.args)}".rstrip())
        started = time.monotonic()
        completed = subprocess.run(command, cwd=REPO_ROOT, env=child_env)
        elapsed = time.monotonic() - started
        if completed.returncode != 0:
            failed_steps.add(step.name)
            results.append((step.name, "FAILED", f"exit {completed.returncode} after {elapsed:.1f}s"))
            continue

        output_paths = list(step.outputs)
        missing_outputs = [output_path for output_path in output_paths if not output_path.exists()]
        if missing_outputs and step.required and strict:
            failed_steps.add(step.name)
            results.append(
                (
                    step.name,
                    "FAILED",
                    "required output missing: "
                    + ", ".join(_display_path(output_path) for output_path in missing_outputs),
                )
            )
            continue

        if missing_outputs and not strict:
            results.append(
                (
                    step.name,
                    "SKIPPED",
                    "missing outputs in permissive mode: "
                    + ", ".join(_display_path(output_path) for output_path in missing_outputs),
                )
            )
            continue

        validator_errors = []
        for output_path in [path for path in output_paths if path.exists()]:
            if step.output_validators:
                for output_validator in step.output_validators:
                    try:
                        validation_message = output_validator(output_path)
                    except Exception as error:  # pragma: no cover - defensive
                        validation_message = str(error)
                    if validation_message:
                        validator_errors.append(validation_message)
            else:
                validation_message = _validate_output(output_path)
                if validation_message:
                    validator_errors.append(validation_message)
        if validator_errors:
            failed_steps.add(step.name)
            results.append((step.name, "FAILED", "; ".join(validator_errors)))
            continue

        if candidate is not None and receipt_path is not None and receipt_path.is_file():
            merge_error = candidate.merge_receipt(receipt_path)
            if merge_error:
                failed_steps.add(step.name)
                results.append((step.name, "FAILED", merge_error))
                continue

        if candidate is not None and output_paths:
            recorded = candidate.manifest.get("artifacts", {})
            mutates = tuple(relative for relative in step.mutates if relative in recorded)
            stale = candidate.complete_step(step.name, output_paths, mutates=mutates)
            if stale:
                failed_steps.add(step.name)
                results.append((step.name, "FAILED", stale))
                continue

        results.append((step.name, "OK", f"{elapsed:.1f}s"))

    if candidate is not None and not failed_steps:
        try:
            checks = candidate.collected_checks()
            if checks:
                candidate.write_contracts(checks)
            candidate.reseal()
        except Exception as error:
            results.append(("reseal", "FAILED", str(error)))
            failed_steps.add("reseal")

    if not results:
        return 0

    name_width = max(len(name) for name, _, _ in results)
    print("\n== Build status ==")
    for name, status, detail in results:
        print(f"{name:<{name_width}}  {status:<7}  {detail}")

    failed = [name for name, status, _ in results if status == "FAILED"]
    if failed:
        print(f"\n{len(failed)} step(s) failed: {', '.join(failed)}")
        if candidate is not None:
            details = [f"{name}: {detail}" for name, status, detail in results if status == "FAILED"]
            candidate.mark_rejected("build failed: " + "; ".join(details))
        return 1
    return 0


if __name__ == "__main__":
    from scripts.release_store import LINEAGE_LEGACY, open_candidate

    parser = argparse.ArgumentParser(description="Build a candidate analytics release. Does not publish it.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit 1 if a required step is skipped, blocked, or produces bad outputs.",
    )
    parser.add_argument(
        "--reference-date",
        default=os.environ.get("CVH_REFERENCE_DATE"),
        help="Explicit reference date for transformations that would otherwise read the wall clock.",
    )
    cli_args = parser.parse_args()
    candidate = open_candidate(
        lineage_class=LINEAGE_LEGACY,
        profile_id="retained_legacy",
        reference_date=cli_args.reference_date,
        raw_lineage_recovered=False,
        notes=(
            "Built from committed processed extracts. Raw PVSC/HRM/Vancouver snapshots are not in this "
            "checkout, so this candidate cannot claim raw lineage."
        ),
    )
    print(f"Candidate directory: {candidate.root}")
    sys.exit(run_build(production_steps(candidate.root), strict=cli_args.strict, candidate=candidate))
