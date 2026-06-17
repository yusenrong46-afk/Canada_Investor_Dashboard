"""Train the production model bundles and log + register them in MLflow.

This is the production analogue of `scripts/run_model_experiments.py`: the lab *compares*
architectures, this script *builds* the servable bundles and records each as an MLflow run +
registry version (stage `None`). Promotion to Production is a separate, explicit step
(`scripts/promote_models.py`).

It sets `MLFLOW_LOG_TRAINING=1` so the cores' `train_bundle()` logging fires — that flag is OFF
by default everywhere else, so a serving-path fallback retrain never pollutes the registry.

Skips cleanly when raw training inputs are absent (the common fresh-clone case), so it is safe
to include in `scripts/build_all.py`.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
if str(MODEL_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_SERVICE_DIR))

# Opt this deliberate run into training-time MLflow logging + registration.
os.environ["MLFLOW_LOG_TRAINING"] = "1"

from base_model import core as vancouver  # noqa: E402
from halifax_model import core as halifax  # noqa: E402


def _present(path_str: str) -> bool:
    return Path(path_str).exists()


def train_vancouver(architectures: list[str]) -> list[tuple[str, str, str]]:
    results: list[tuple[str, str, str]] = []
    if not _present(vancouver.DEFAULT_DATA_PATH):
        print(f"SKIP vancouver: raw listings CSV not found at {vancouver.DEFAULT_DATA_PATH}")
        return results
    for architecture in architectures:
        print(f"Training vancouver [{architecture}] ...")
        bundle = vancouver.train_bundle(architecture=architecture)
        print(f"  -> {bundle.model_version} ({bundle.model_architecture}) saved + logged")
        results.append(("vancouver", architecture, bundle.model_version))
    return results


def train_halifax() -> list[tuple[str, str, str]]:
    results: list[tuple[str, str, str]] = []
    if not _present(halifax.DEFAULT_DATA_PATH):
        print(f"SKIP halifax: training CSV not found at {halifax.DEFAULT_DATA_PATH}")
        return results
    print("Training halifax [local-per-type] ...")
    bundle = halifax.train_bundle()
    print(f"  -> {bundle.model_version} ({bundle.model_architecture}) saved + logged")
    results.append(("halifax_maritimes", "local-per-type", bundle.model_version))
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", choices=["vancouver", "halifax", "all"], default="all")
    parser.add_argument(
        "--vancouver-architectures",
        default="local-per-type,pooled-features",
        help="Comma-separated Vancouver architectures to train and register.",
    )
    args = parser.parse_args()

    architectures = [item.strip() for item in args.vancouver_architectures.split(",") if item.strip()]
    results: list[tuple[str, str, str]] = []
    if args.market in ("vancouver", "all"):
        results += train_vancouver(architectures)
    if args.market in ("halifax", "all"):
        results += train_halifax()

    if not results:
        print("No production bundles trained (inputs missing). Nothing registered.")
        return

    print(f"\nTrained and registered {len(results)} bundle(s):")
    for market, architecture, version in results:
        print(f"  - {market}: {version} [{architecture}]")
    print("\nNext: promote the spatial-CV winner with `scripts/promote_models.py`.")


if __name__ == "__main__":
    main()
