from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_PATH = REPO_ROOT / "data" / "processed" / "vancouver_base_model_training.csv"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "reports" / "data_quality_report.md"


KEY_COLUMNS = ["price", "propertyType", "postalCode", "livingAreaSqft", "bedrooms", "bathrooms"]

OUTLIER_RULES = {
  "price": (100_000, 10_000_000),
  "livingAreaSqft": (250, 10_000),
  "bedrooms": (0, 10),
  "bathrooms": (0, 10),
}


def format_number(value: Any) -> str:
  try:
    return f"{int(value):,}"
  except (TypeError, ValueError):
    return "not available"


def read_data(path: Path) -> pd.DataFrame | None:
  if not path.exists():
    return None
  return pd.read_csv(path)


def missing_value_rows(frame: pd.DataFrame) -> list[tuple[str, str]]:
  rows = []
  for column in KEY_COLUMNS:
    if column not in frame.columns:
      rows.append((column, "column not found"))
      continue

    missing_count = int(frame[column].isna().sum())
    missing_rate = missing_count / len(frame) if len(frame) else 0
    rows.append((column, f"{missing_count:,} ({missing_rate:.2%})"))
  return rows


def outlier_rows(frame: pd.DataFrame) -> list[tuple[str, str]]:
  rows = []
  for column, (low, high) in OUTLIER_RULES.items():
    if column not in frame.columns:
      rows.append((column, "column not found"))
      continue

    numeric_values = pd.to_numeric(frame[column], errors="coerce")
    outliers = numeric_values[(numeric_values < low) | (numeric_values > high)]
    rows.append((column, f"{int(outliers.shape[0]):,} outside {low:,} to {high:,}"))
  return rows


def build_data_quality_report(data_path: Path = DEFAULT_DATA_PATH) -> str:
  frame = read_data(data_path)

  lines = [
    "# Data Quality Report",
    "",
    f"Source inspected: `{data_path}`",
    "",
  ]

  if frame is None:
    lines.extend(
      [
        "## Status",
        "",
        "Data file not found. The report script ran successfully, but no row-level quality checks could be calculated.",
        "",
        "Needed file:",
        "",
        f"- `{data_path}`",
        "",
      ]
    )
    return "\n".join(lines)

  duplicate_count = int(frame.duplicated().sum())

  lines.extend(
    [
      "## Dataset Shape",
      "",
      "| Check | Result |",
      "|---|---:|",
      f"| row count | {format_number(len(frame))} |",
      f"| column count | {format_number(len(frame.columns))} |",
      f"| duplicate rows | {format_number(duplicate_count)} |",
      "",
      "## Missing Values By Key Column",
      "",
      "| Column | Missing values |",
      "|---|---:|",
    ]
  )

  for column, result in missing_value_rows(frame):
    lines.append(f"| {column} | {result} |")

  lines.extend(
    [
      "",
      "## Simple Outlier Checks",
      "",
      "| Column | Result |",
      "|---|---:|",
    ]
  )

  for column, result in outlier_rows(frame):
    lines.append(f"| {column} | {result} |")

  missing_optional = [column for column in KEY_COLUMNS if column not in frame.columns]
  lines.extend(["", "## Notes", ""])
  if missing_optional:
    lines.append(f"- Optional or expected columns not found: {', '.join(missing_optional)}.")
  else:
    lines.append("- All key columns for the current listing-price workflow were found.")
  lines.append("- These checks are simple sanity checks, not a complete production data contract.")
  lines.append("- The target is listing price, so this report should not be described as sale-price validation.")
  lines.append("")

  return "\n".join(lines)


def write_data_quality_report(output_path: Path = DEFAULT_OUTPUT_PATH, data_path: Path = DEFAULT_DATA_PATH) -> Path:
  output_path.parent.mkdir(parents=True, exist_ok=True)
  output_path.write_text(build_data_quality_report(data_path=data_path))
  return output_path


if __name__ == "__main__":
  path = write_data_quality_report()
  print(f"Wrote {path}")
