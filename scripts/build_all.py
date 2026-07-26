from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"
RAW_HALIFAX_DIR = REPO_ROOT / "data" / "raw" / "halifax"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
WAREHOUSE_PATH = REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb"
MODEL_BUNDLE_PATH = REPO_ROOT / "artifacts" / "model-service" / "models" / "vancouver_base_price_bundle_v5.pkl"
HALIFAX_MODEL_BUNDLE_PATH = REPO_ROOT / "artifacts" / "model-service" / "models" / "halifax_base_price_bundle_v1.pkl"
SEATTLE_UPLIFT_BUNDLE_PATH = REPO_ROOT / "artifacts" / "model-service" / "models" / "seattle_observed_uplift_bundle_v2.pkl"
WAREHOUSE_REPORT_PATH = REPO_ROOT / "reports" / "analytics_warehouse_report.md"
EVIDENCE_REPORT_PATH = REPO_ROOT / "reports" / "model_experiments_report.md"
MODEL_METRICS_REPORT_PATH = REPO_ROOT / "reports" / "model_metrics_report.md"
DATA_QUALITY_REPORT_PATH = REPO_ROOT / "reports" / "data_quality_report.md"
MARKET_EVIDENCE_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "market_evidence.json"
MARKET_MAP_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "market_map.json"
HALIFAX_UPLIFT_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "halifax_uplift.json"
MARKET_TREND_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "market_trend.json"
MODELS_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "model_experiments.json"


@dataclass(frozen=True)
class BuildStep:
    name: str
    script: Path
    args: tuple[str, ...] = ()
    inputs: tuple[Path, ...] = ()
    outputs: tuple[Path, ...] = ()
    required: bool = False
    output_validators: tuple[Callable[[Path], str], ...] = ()


STRICT_REQUIRED_STEPS: frozenset[str] = frozenset(
    {
        "analytics warehouse",
        "market evidence export",
        "market map export",
        "model metrics report",
        "data quality report",
        "model experiment lab",
    }
)


BUILD_STEPS = [
    BuildStep(
        name="analytics warehouse",
        script=SCRIPTS_DIR / "build_property_warehouse.py",
        inputs=(PROCESSED_DIR / "vancouver_base_model_training.csv",),
        outputs=(WAREHOUSE_PATH, WAREHOUSE_REPORT_PATH),
        required="analytics warehouse" in STRICT_REQUIRED_STEPS,
    ),
    BuildStep(
        name="market trend (NHPI)",
        script=SCRIPTS_DIR / "build_market_trend.py",
        inputs=(REPO_ROOT / "data" / "raw" / "market" / "18100205.csv",),
        outputs=(MARKET_TREND_EXPORT_PATH,),
        required=False,
    ),
    BuildStep(
        name="market evidence export",
        script=SCRIPTS_DIR / "export_market_evidence.py",
        inputs=(WAREHOUSE_PATH,),
        outputs=(MARKET_EVIDENCE_EXPORT_PATH,),
        required="market evidence export" in STRICT_REQUIRED_STEPS,
    ),
    BuildStep(
        name="market map export",
        script=SCRIPTS_DIR / "export_market_map.py",
        inputs=(WAREHOUSE_PATH,),
        outputs=(MARKET_MAP_EXPORT_PATH,),
        required="market map export" in STRICT_REQUIRED_STEPS,
    ),
    BuildStep(
        name="halifax renovation uplift",
        script=SCRIPTS_DIR / "build_halifax_uplift.py",
        inputs=(
            RAW_HALIFAX_DIR / "hrm_building_permits_geolocated.csv",
            PROCESSED_DIR / "halifax_base_model_training.csv",
        ),
        outputs=(HALIFAX_UPLIFT_EXPORT_PATH,),
        required=False,
    ),
    BuildStep(
        name="model experiment lab",
        script=SCRIPTS_DIR / "run_model_experiments.py",
        inputs=(WAREHOUSE_PATH,),
        outputs=(MODELS_EXPORT_PATH, EVIDENCE_REPORT_PATH),
        required="model experiment lab" in STRICT_REQUIRED_STEPS,
    ),
    BuildStep(
        name="model metrics report",
        script=SCRIPTS_DIR / "generate_model_report.py",
        inputs=(PROCESSED_DIR / "vancouver_base_model_summary.json",),
        outputs=(MODEL_METRICS_REPORT_PATH,),
        required="model metrics report" in STRICT_REQUIRED_STEPS,
    ),
    BuildStep(
        name="data quality report",
        script=SCRIPTS_DIR / "generate_data_quality_report.py",
        inputs=(PROCESSED_DIR / "vancouver_base_model_training.csv",),
        outputs=(DATA_QUALITY_REPORT_PATH,),
        required="data quality report" in STRICT_REQUIRED_STEPS,
    ),
]


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


def run_build(steps: list[BuildStep] = BUILD_STEPS, *, strict: bool = False) -> int:
    """Run pipeline steps in order. With --strict, required steps must finish with valid outputs."""
    results: list[tuple[str, str, str]] = []
    for step in steps:
        if not step.script.exists():
            reason = f"script not present: {_display_path(step.script)}"
            print(f"\n== {step.name}: SKIPPED ({reason})")
            status = "FAILED" if strict and step.required else "SKIPPED"
            results.append((step.name, status, reason))
            continue

        missing = [_display_path(path) for path in step.inputs if not path.exists()]
        if missing:
            reason = "missing inputs: " + ", ".join(missing)
            print(f"\n== {step.name}: SKIPPED ({reason})")
            status = "FAILED" if strict and step.required else "SKIPPED"
            results.append((step.name, status, reason))
            continue

        command = [sys.executable, str(step.script), *step.args]
        print(f"\n== {step.name}: running {_display_path(step.script)} {' '.join(step.args)}".rstrip())
        started = time.monotonic()
        completed = subprocess.run(command, cwd=REPO_ROOT)
        elapsed = time.monotonic() - started
        if completed.returncode == 0:
            output_paths = list(step.outputs)
            missing_outputs = [output_path for output_path in output_paths if not output_path.exists()]
            if missing_outputs and step.required and strict:
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
                results.append((step.name, "FAILED", "; ".join(validator_errors)))
            else:
                results.append((step.name, "OK", f"{elapsed:.1f}s"))
        else:
            results.append((step.name, "FAILED", f"exit {completed.returncode} after {elapsed:.1f}s"))

    name_width = max(len(name) for name, _, _ in results)
    print("\n== Build status ==")
    for name, status, detail in results:
        print(f"{name:<{name_width}}  {status:<7}  {detail}")

    failed = [name for name, status, _ in results if status == "FAILED"]
    if failed:
        print(f"\n{len(failed)} step(s) failed: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run local analytics and report build pipeline steps.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit 1 if a required step is skipped or produces bad/missing outputs.",
    )
    cli_args = parser.parse_args()
    sys.exit(run_build(strict=cli_args.strict))
