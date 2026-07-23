from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"
RAW_HALIFAX_DIR = REPO_ROOT / "data" / "raw" / "halifax"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
WAREHOUSE_PATH = REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb"
MODEL_BUNDLE_PATH = REPO_ROOT / "artifacts" / "model-service" / "models" / "vancouver_base_price_bundle_v5.pkl"
HALIFAX_MODEL_BUNDLE_PATH = REPO_ROOT / "artifacts" / "model-service" / "models" / "halifax_base_price_bundle_v1.pkl"
SEATTLE_UPLIFT_BUNDLE_PATH = REPO_ROOT / "artifacts" / "model-service" / "models" / "seattle_observed_uplift_bundle_v2.pkl"


@dataclass(frozen=True)
class BuildStep:
    name: str
    script: Path
    args: tuple[str, ...] = ()
    inputs: tuple[Path, ...] = ()


BUILD_STEPS = [
    BuildStep(
        name="halifax training extract",
        script=SCRIPTS_DIR / "setup_halifax_data.py",
        args=("--build-training",),
        inputs=(
            RAW_HALIFAX_DIR / "pvsc_dwelling_characteristics_hrm.csv",
            RAW_HALIFAX_DIR / "pvsc_parcel_sales_hrm.csv",
            RAW_HALIFAX_DIR / "pvsc_assessed_values_hrm.csv",
            RAW_HALIFAX_DIR / "hrm_civic_addresses.csv",
        ),
    ),
    BuildStep(
        name="Vancouver base-model artifact",
        script=SCRIPTS_DIR / "train_model_bundles.py",
        args=("--component", "vancouver"),
        inputs=(PROCESSED_DIR / "vancouver_base_model_training.csv",),
    ),
    BuildStep(
        name="Halifax base-model artifact",
        script=SCRIPTS_DIR / "train_model_bundles.py",
        args=("--component", "halifax"),
        inputs=(PROCESSED_DIR / "halifax_base_model_training.csv",),
    ),
    BuildStep(
        name="analytics warehouse",
        script=SCRIPTS_DIR / "build_property_warehouse.py",
        inputs=(PROCESSED_DIR / "vancouver_base_model_training.csv",),
    ),
    BuildStep(
        name="market trend (NHPI)",
        script=SCRIPTS_DIR / "build_market_trend.py",
        inputs=(REPO_ROOT / "data" / "raw" / "market" / "18100205.csv",),
    ),
    BuildStep(
        name="market evidence export",
        script=SCRIPTS_DIR / "export_market_evidence.py",
        inputs=(WAREHOUSE_PATH,),
    ),
    BuildStep(
        name="market map export",
        script=SCRIPTS_DIR / "export_market_map.py",
        inputs=(WAREHOUSE_PATH,),
    ),
    BuildStep(
        name="Seattle uplift-model artifact",
        script=SCRIPTS_DIR / "train_model_bundles.py",
        args=("--component", "seattle-uplift"),
        inputs=(
            REPO_ROOT / "data" / "raw" / "seattle" / "building_permits.csv",
            REPO_ROOT / "data" / "raw" / "seattle" / "rpsale_extr.csv",
            REPO_ROOT / "data" / "raw" / "seattle" / "resbldg_extr.csv",
        ),
    ),
    BuildStep(
        name="halifax renovation uplift",
        script=SCRIPTS_DIR / "build_halifax_uplift.py",
        inputs=(
            RAW_HALIFAX_DIR / "hrm_building_permits_geolocated.csv",
            PROCESSED_DIR / "halifax_base_model_training.csv",
        ),
    ),
    BuildStep(
        name="model experiment lab",
        script=SCRIPTS_DIR / "run_model_experiments.py",
        inputs=(WAREHOUSE_PATH,),
    ),
    BuildStep(
        name="model metrics report",
        script=SCRIPTS_DIR / "generate_model_report.py",
        inputs=(
            MODEL_BUNDLE_PATH,
            HALIFAX_MODEL_BUNDLE_PATH,
            SEATTLE_UPLIFT_BUNDLE_PATH,
            PROCESSED_DIR / "vancouver_base_model_summary.json",
        ),
    ),
]


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def run_build(steps: list[BuildStep] = BUILD_STEPS) -> int:
    """Run every build step in order. Steps whose inputs (or script) are not
    present are SKIPPED with the reason; only steps that had their inputs and
    still failed make the build exit nonzero."""
    results: list[tuple[str, str, str]] = []
    for step in steps:
        if not step.script.exists():
            reason = f"script not present yet: {_display_path(step.script)}"
            print(f"\n== {step.name}: SKIPPED ({reason})")
            results.append((step.name, "SKIPPED", reason))
            continue

        # Inputs are checked at execution time because earlier steps create them.
        missing = [_display_path(path) for path in step.inputs if not path.exists()]
        if missing:
            reason = "missing inputs: " + ", ".join(missing)
            print(f"\n== {step.name}: SKIPPED ({reason})")
            results.append((step.name, "SKIPPED", reason))
            continue

        command = [sys.executable, str(step.script), *step.args]
        print(f"\n== {step.name}: running {_display_path(step.script)} {' '.join(step.args)}".rstrip())
        started = time.monotonic()
        completed = subprocess.run(command, cwd=REPO_ROOT)
        elapsed = time.monotonic() - started
        if completed.returncode == 0:
            results.append((step.name, "OK", f"{elapsed:.1f}s"))
        else:
            results.append((step.name, "FAILED", f"exit {completed.returncode} after {elapsed:.1f}s"))

    name_width = max(len(name) for name, _, _ in results)
    print("\n== Build status ==")
    for name, status, detail in results:
        print(f"{name:<{name_width}}  {status:<7}  {detail}")

    failed = [name for name, status, _ in results if status == "FAILED"]
    if failed:
        print(f"\n{len(failed)} step(s) failed with inputs present: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(run_build())
