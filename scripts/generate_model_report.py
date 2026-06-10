from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
DEFAULT_ARTIFACT_PATH = MODEL_SERVICE_DIR / "models" / "vancouver_base_price_bundle_v5.pkl"
DEFAULT_SUMMARY_PATH = REPO_ROOT / "data" / "processed" / "vancouver_base_model_summary.json"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "reports" / "model_metrics_report.md"


def format_number(value: Any, digits: int = 2) -> str:
  if value is None:
    return "not available"
  try:
    number = float(value)
  except (TypeError, ValueError):
    return "not available"
  return f"{number:,.{digits}f}"


def format_percent(value: Any) -> str:
  if value is None:
    return "not available"
  try:
    return f"{float(value) * 100:.2f}%"
  except (TypeError, ValueError):
    return "not available"


def load_json(path: Path) -> dict[str, Any] | None:
  if not path.exists():
    return None
  return json.loads(path.read_text())


def load_model_bundle(path: Path) -> tuple[Any | None, str | None]:
  if not path.exists():
    return None, f"Model artifact not found: {path}"

  sys.path.insert(0, str(MODEL_SERVICE_DIR))
  try:
    with path.open("rb") as file:
      return pickle.load(file), None
  except Exception as exc:  # pragma: no cover - depends on local pickle/runtime versions
    return None, f"Could not load model artifact: {exc}"


def weighted_average(rows: list[dict[str, Any]], metric: str) -> float | None:
  total_weight = 0
  weighted_sum = 0.0

  for row in rows:
    value = row.get(metric)
    weight = row.get("n", 0)
    if value is None or not weight:
      continue
    weighted_sum += float(value) * int(weight)
    total_weight += int(weight)

  if total_weight == 0:
    return None
  return weighted_sum / total_weight


def metrics_from_bundle(bundle: Any) -> dict[str, Any] | None:
  summary = getattr(bundle, "evaluation_summary", None)
  if not isinstance(summary, dict):
    return None

  per_type = summary.get("perType", {})
  if not isinstance(per_type, dict) or not per_type:
    return None

  rows = []
  for property_type, details in per_type.items():
    holdout = details.get("holdout", {})
    rows.append(
      {
        "segment": property_type,
        "model": details.get("selectedModel", "not available"),
        "mae": holdout.get("mae"),
        "rmse": holdout.get("rmse"),
        "mape": holdout.get("mape"),
        "r2": holdout.get("r2"),
        "n": holdout.get("rows"),
      }
    )

  overall = summary.get("overallWeightedMetrics", {})
  rows.insert(
    0,
    {
      "segment": "All supported property types",
      "model": "selected by property type",
      "mae": overall.get("holdoutMae"),
      "rmse": weighted_average(rows, "rmse"),
      "mape": overall.get("holdoutMape"),
      "r2": overall.get("holdoutR2"),
      "n": sum(int(row.get("n") or 0) for row in rows),
    },
  )

  return {
    "rows": rows,
    "selected_models": summary.get("selectedModels", {}),
    "validation_strategy": summary.get("validationStrategy", {}),
  }


def conformal_rows(bundle: Any) -> list[dict[str, Any]] | None:
  calibrations = getattr(bundle, "conformal_calibrations", None)
  if not isinstance(calibrations, dict) or not calibrations:
    return None

  rows = []
  for property_type, calibration in calibrations.items():
    rows.append(
      {
        "segment": property_type,
        "target_coverage": getattr(calibration, "target_coverage", None),
        "empirical_coverage": getattr(calibration, "empirical_coverage", None),
        "calibration_rows": getattr(calibration, "calibration_rows", None),
        "coverage_rows": getattr(calibration, "coverage_rows", None),
        "ratio": getattr(calibration, "ratio", None),
      }
    )
  return rows


def spatial_rows(bundle: Any) -> list[dict[str, Any]] | None:
  summary = getattr(bundle, "evaluation_summary", None)
  if not isinstance(summary, dict):
    return None

  per_type = summary.get("perType", {})
  if not isinstance(per_type, dict) or not per_type:
    return None

  rows = []
  for property_type, details in per_type.items():
    if "spatialCvMae" not in details and "randomCvMae" not in details:
      continue
    rows.append(
      {
        "segment": property_type,
        "random_cv_mae": details.get("randomCvMae"),
        "spatial_cv_mae": details.get("spatialCvMae"),
        "gap_pct": details.get("spatialGeneralizationGapPct"),
      }
    )
  return rows or None


def data_quality_rows(summary: dict[str, Any] | None) -> list[tuple[str, str]]:
  if not summary:
    return [("processed summary file", "not found")]

  row_counts = summary.get("rowCounts", {})
  missingness = summary.get("eda", {}).get("missingness", {})

  rows = [
    ("rows before cleaning", format_number(row_counts.get("totalRows"), 0)),
    ("Vancouver rows", format_number(row_counts.get("vancouverRows"), 0)),
    ("usable rows before outlier removal", format_number(row_counts.get("usableRowsBeforeOutlierRemoval"), 0)),
    ("usable rows after cleaning", format_number(row_counts.get("usableRows"), 0)),
  ]

  for column in ["price", "livingAreaSqft", "bedrooms", "bathrooms", "postalCode", "propertyType"]:
    details = missingness.get(column)
    if details:
      rows.append((f"missing {column}", f"{format_number(details.get('missingCount'), 0)} ({format_percent(details.get('missingRate'))})"))
    else:
      rows.append((f"missing {column}", "not available"))

  return rows


def build_model_report(
  artifact_path: Path = DEFAULT_ARTIFACT_PATH,
  summary_path: Path = DEFAULT_SUMMARY_PATH,
) -> str:
  bundle, bundle_error = load_model_bundle(artifact_path)
  summary = load_json(summary_path)
  metrics = metrics_from_bundle(bundle) if bundle is not None else None

  lines = [
    "# Model Metrics Report",
    "",
    "## Base Price Model",
    "",
    "| Segment | Model | MAE | RMSE | MAPE | R2 | N |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ]

  if metrics:
    for row in metrics["rows"]:
      lines.append(
        "| {segment} | {model} | ${mae} | ${rmse} | {mape} | {r2} | {n} |".format(
          segment=row["segment"],
          model=row["model"],
          mae=format_number(row["mae"], 0),
          rmse=format_number(row["rmse"], 0),
          mape=format_percent(row["mape"]),
          r2=format_number(row["r2"], 3),
          n=format_number(row["n"], 0),
        )
      )
  else:
    lines.append("| Metrics not available yet | not available | not available | not available | not available | not available | not available |")

  lines.extend(["", "## Model Selection Notes", ""])
  if metrics:
    selected_models = metrics["selected_models"]
    if selected_models:
      for property_type, model_name in selected_models.items():
        lines.append(f"- {property_type}: `{model_name}` selected by cross-validation MAE.")
    lines.append("- The app compares XGBoost and Random Forest per property type when the training artifact is available.")
  else:
    lines.append("- Metrics not available yet.")
    lines.append(f"- {bundle_error or 'A saved model artifact or evaluation file is needed before metrics can be reported.'}")

  lines.extend(["", "## Conformal Coverage", ""])
  conformal = conformal_rows(bundle) if bundle is not None else None
  if conformal:
    lines.extend(
      [
        "| Segment | Target coverage | Empirical coverage | Calibration rows | Coverage rows | Interval ratio |",
        "|---|---:|---:|---:|---:|---:|",
      ]
    )
    for row in conformal:
      empirical = format_percent(row["empirical_coverage"]) if row["empirical_coverage"] is not None else "not measured (too few rows)"
      lines.append(
        "| {segment} | {target} | {empirical} | {calibration_rows} | {coverage_rows} | {ratio} |".format(
          segment=row["segment"],
          target=format_percent(row["target_coverage"]),
          empirical=empirical,
          calibration_rows=format_number(row["calibration_rows"], 0),
          coverage_rows=format_number(row["coverage_rows"], 0),
          ratio=format_number(row["ratio"], 4),
        )
      )
  else:
    lines.append(
      "Conformal coverage is not available: the saved bundle predates v5 (or no artifact was found), so no calibration was stored. This report does not invent coverage numbers."
    )

  lines.extend(["", "## Spatial Generalization", ""])
  spatial = spatial_rows(bundle) if bundle is not None else None
  if spatial:
    lines.extend(
      [
        "| Segment | Random CV MAE | Spatial CV MAE | Gap |",
        "|---|---:|---:|---:|",
      ]
    )
    for row in spatial:
      lines.append(
        "| {segment} | ${random_mae} | {spatial_mae} | {gap} |".format(
          segment=row["segment"],
          random_mae=format_number(row["random_cv_mae"], 0),
          spatial_mae=f"${format_number(row['spatial_cv_mae'], 0)}" if row["spatial_cv_mae"] is not None else "not run",
          gap=f"{format_number(row['gap_pct'], 1)}%" if row["gap_pct"] is not None else "not available",
        )
      )
    lines.append("")
    lines.append("Spatial CV uses GroupKFold grouped by postal FSA, so each validation fold contains only postal areas the model never saw in training.")
  else:
    lines.append(
      "Spatial generalization metrics are not available: the saved bundle predates v5 (or no artifact was found), so no GroupKFold results were stored. This report does not invent gap numbers."
    )

  lines.extend(["", "## Data Quality Summary", "", "| Check | Result |", "|---|---:|"])
  for check, result in data_quality_rows(summary):
    lines.append(f"| {check} | {result} |")

  lines.extend(
    [
      "",
      "## Limitations",
      "",
      "- The base model estimates listing price, not final sale price.",
      "- Renovation uplift is a separate workflow and should not be treated as causal Vancouver sale-price proof.",
      "- If the saved artifact is missing, this report intentionally refuses to invent MAE, RMSE, MAPE, or R2.",
      "- The dashboard is useful for screening and explanation, but it still needs local comparable-sale review.",
      "",
    ]
  )

  return "\n".join(lines)


def write_model_report(output_path: Path = DEFAULT_OUTPUT_PATH, artifact_path: Path = DEFAULT_ARTIFACT_PATH, summary_path: Path = DEFAULT_SUMMARY_PATH) -> Path:
  output_path.parent.mkdir(parents=True, exist_ok=True)
  output_path.write_text(build_model_report(artifact_path=artifact_path, summary_path=summary_path))
  return output_path


if __name__ == "__main__":
  path = write_model_report()
  print(f"Wrote {path}")
