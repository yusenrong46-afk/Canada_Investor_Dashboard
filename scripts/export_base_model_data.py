from __future__ import annotations

import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = PROJECT_ROOT / "artifacts" / "model-service"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "processed"

sys.path.insert(0, str(MODEL_SERVICE_DIR))

from service import DEFAULT_DATA_PATH, NUMERIC_FEATURES, CATEGORICAL_FEATURES, _load_training_frame  # noqa: E402


def main() -> None:
    output_dir = DEFAULT_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    frame, row_counts, eda_summary, _clusterer = _load_training_frame(DEFAULT_DATA_PATH)

    export_columns = [
        "price",
        "logPrice",
        "pricePerSqft",
        "propertyType",
        "postalCode",
        *CATEGORICAL_FEATURES,
        *NUMERIC_FEATURES,
    ]
    export_columns = list(dict.fromkeys(export_columns))

    data_path = output_dir / "vancouver_base_model_training.csv"
    summary_path = output_dir / "vancouver_base_model_summary.json"

    frame[export_columns].to_csv(data_path, index=False)
    summary_path.write_text(
        json.dumps(
            {
                "sourcePath": DEFAULT_DATA_PATH,
                "rowCounts": row_counts,
                "propertyTypeCounts": frame["propertyType"].value_counts().to_dict(),
                "exportedColumns": export_columns,
                "eda": eda_summary,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Wrote {len(frame):,} rows to {data_path}")
    print(f"Wrote summary to {summary_path}")


if __name__ == "__main__":
    main()
