from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = PROJECT_ROOT / "artifacts" / "model-service"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "processed"
DEFAULT_RAW_PATH = Path.home() / "Downloads" / "data_bc.csv"

sys.path.insert(0, str(MODEL_SERVICE_DIR))

from base_model.core import CATEGORICAL_FEATURES, NUMERIC_FEATURES, _load_training_frame  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export Vancouver training rows including listingDate for temporal holdouts.")
    parser.add_argument(
        "--source",
        default=str(DEFAULT_RAW_PATH if DEFAULT_RAW_PATH.is_file() else PROJECT_ROOT / "data" / "raw" / "data_bc.csv"),
        help="Raw Vancouver listings CSV with addressLocality and Date Listed columns.",
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser


def main() -> None:
    args = build_parser().parse_args()
    source_path = Path(args.source)
    if not source_path.is_file():
        raise SystemExit(f"Vancouver raw listings not found: {source_path}")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    frame, row_counts, eda_summary = _load_training_frame(str(source_path))

    export_columns = [
        "price",
        "logPrice",
        "pricePerSqft",
        "propertyType",
        "postalCode",
        "listingDate",
        "yearBuilt",
        *CATEGORICAL_FEATURES,
        *NUMERIC_FEATURES,
    ]
    export_columns = [column for column in dict.fromkeys(export_columns) if column in frame.columns]

    data_path = output_dir / "vancouver_base_model_training.csv"
    summary_path = output_dir / "vancouver_base_model_summary.json"

    frame[export_columns].to_csv(data_path, index=False)
    dated_rows = int(frame["listingDate"].notna().sum()) if "listingDate" in frame.columns else 0
    if dated_rows == 0 and os.environ.get("ALLOW_EMPTY_DATES") not in {"1", "true", "TRUE"}:
        raise SystemExit(
            "Vancouver export has 0 usable listingDate values. "
            "The raw listings CSV must include populated Date Listed / Last Updated fields "
            "for Phase E temporal holdouts. Set ALLOW_EMPTY_DATES=1 only to force a dated-empty export."
        )
    summary_path.write_text(
        json.dumps(
            {
                "sourcePath": str(source_path),
                "rowCounts": {
                    **row_counts,
                    "datedRows": dated_rows,
                    "undatedRows": int(len(frame) - dated_rows),
                },
                "propertyTypeCounts": frame["propertyType"].value_counts().to_dict(),
                "exportedColumns": export_columns,
                "eda": eda_summary,
                "temporalHoldoutReady": dated_rows > 0,
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )

    print(f"Wrote {len(frame):,} rows to {data_path}")
    print(f"Dated rows: {dated_rows:,} / {len(frame):,}")
    print(f"Wrote summary to {summary_path}")


if __name__ == "__main__":
    main()
