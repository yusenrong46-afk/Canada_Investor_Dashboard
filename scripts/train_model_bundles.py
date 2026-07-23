from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from base_model import core as vancouver_model  # noqa: E402
from common.artifact_loader import build_manifest_entry, upsert_manifest_entry  # noqa: E402
from halifax_model import core as halifax_model  # noqa: E402
from uplift_model import core as seattle_uplift  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Train approved model bundles offline. Inference never invokes this command.",
    )
    parser.add_argument(
        "--component",
        choices=("all", "vancouver", "halifax", "seattle-uplift"),
        default="all",
    )
    parser.add_argument(
        "--vancouver-data",
        default=vancouver_model.DEFAULT_DATA_PATH,
    )
    parser.add_argument(
        "--halifax-data",
        default=halifax_model.DEFAULT_DATA_PATH,
    )
    parser.add_argument("--seattle-permits", default=seattle_uplift.DEFAULT_PERMITS_PATH)
    parser.add_argument("--king-county-sales", default=seattle_uplift.DEFAULT_SALES_PATH)
    parser.add_argument("--king-county-buildings", default=seattle_uplift.DEFAULT_BUILDINGS_PATH)
    return parser


def _assert_training_environment() -> None:
    if sys.version_info[:2] != (3, 11):
        if os.environ.get("ALLOW_PYTHON_MISMATCH") in {"1", "true", "TRUE"}:
            print(
                "WARNING: train_model_bundles prefers Python 3.11; "
                f"ALLOW_PYTHON_MISMATCH is set so continuing on Python "
                f"{sys.version_info.major}.{sys.version_info.minor}.",
                file=sys.stderr,
            )
        else:
            raise SystemExit(
                "train_model_bundles requires Python 3.11; "
                f"this interpreter is Python {sys.version_info.major}.{sys.version_info.minor}. "
                "Set ALLOW_PYTHON_MISMATCH=1 only for local emergency retrains."
            )
    if os.environ.get("PYTHONHASHSEED") is None:
        print(
            "WARNING: PYTHONHASHSEED is unset; training may not be reproducible across runs.",
            file=sys.stderr,
        )


def _write_manifest(artifact_path: Path, *, model_version: str, trained_at: str) -> None:
    upsert_manifest_entry(
        artifact_path,
        build_manifest_entry(
            artifact_path,
            model_version=model_version,
            trained_at=trained_at,
        ),
    )


def main() -> int:
    _assert_training_environment()
    args = build_parser().parse_args()

    if args.component in {"all", "vancouver"}:
        bundle = vancouver_model.train_bundle(data_path=args.vancouver_data)
        _write_manifest(vancouver_model.ARTIFACT_PATH, model_version=bundle.model_version, trained_at=bundle.trained_at)
        print(f"trained {bundle.model_version} -> {vancouver_model.ARTIFACT_PATH}")

    if args.component in {"all", "halifax"}:
        bundle = halifax_model.train_bundle(data_path=args.halifax_data)
        _write_manifest(halifax_model.ARTIFACT_PATH, model_version=bundle.model_version, trained_at=bundle.trained_at)
        print(f"trained {bundle.model_version} -> {halifax_model.ARTIFACT_PATH}")

    if args.component in {"all", "seattle-uplift"}:
        paths = seattle_uplift.UpliftDataPaths(
            permits=Path(args.seattle_permits).expanduser(),
            sales=Path(args.king_county_sales).expanduser(),
            buildings=Path(args.king_county_buildings).expanduser(),
        )
        bundle = seattle_uplift.train_uplift_bundle(paths)
        _write_manifest(
            seattle_uplift.UPLIFT_ARTIFACT_PATH,
            model_version=bundle.model_version,
            trained_at=bundle.trained_at,
        )
        print(f"trained {bundle.model_version} -> {seattle_uplift.UPLIFT_ARTIFACT_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
