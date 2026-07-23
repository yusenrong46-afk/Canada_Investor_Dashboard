from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
VANCOUVER_ARTIFACT = MODEL_SERVICE_DIR / "models" / "vancouver_base_price_bundle_v5.pkl"
HALIFAX_ARTIFACT = MODEL_SERVICE_DIR / "models" / "halifax_base_price_bundle_v1.pkl"
VANCOUVER_SUMMARY = REPO_ROOT / "data" / "processed" / "vancouver_base_model_summary.json"
HALIFAX_SUMMARY = REPO_ROOT / "data" / "processed" / "halifax_base_model_summary.json"
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


def load_pickle_bundle(path: Path, expected_type: type, label: str) -> tuple[Any | None, str | None]:
  if not path.exists():
    return None, f"Model artifact not found: {path}"

  sys.path.insert(0, str(MODEL_SERVICE_DIR))
  from common.artifact_loader import ModelArtifactError, load_approved_pickle

  try:
    return (
      load_approved_pickle(
        path,
        expected_type=expected_type,
        artifact_label=label,
        validate=lambda bundle: [] if hasattr(bundle, "evaluation_summary") else ["evaluation_summary is missing"],
      ),
      None,
    )
  except ModelArtifactError as exc:
    return None, str(exc)


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
    random_holdout = details.get("randomHoldout", {})
    rows.append(
      {
        "segment": property_type,
        "model": details.get("selectedModel", "not available"),
        "mae": holdout.get("mae"),
        "rmse": holdout.get("rmse"),
        "mape": holdout.get("mape"),
        "r2": holdout.get("r2"),
        "n": holdout.get("rows"),
        "random_mae": random_holdout.get("mae"),
        "random_mape": random_holdout.get("mape"),
        "random_n": random_holdout.get("rows"),
      }
    )

  overall = summary.get("overallWeightedMetrics", {})
  rows.insert(
    0,
    {
      "segment": "All supported property types",
      "model": "selected by property type",
      "mae": overall.get("holdoutMae"),
      "rmse": None,
      "mape": overall.get("holdoutMape"),
      "r2": overall.get("holdoutR2"),
      "n": sum(int(row.get("n") or 0) for row in rows),
      "random_mae": overall.get("randomHoldoutMae"),
      "random_mape": overall.get("randomHoldoutMape"),
      "random_n": None,
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

  waivers = getattr(bundle, "conformal_coverage_waivers", None) or {}
  rows = []
  for property_type, calibration in calibrations.items():
    waiver = waivers.get(property_type) if isinstance(waivers, dict) else None
    rows.append(
      {
        "segment": property_type,
        "target_coverage": getattr(calibration, "target_coverage", None),
        "empirical_coverage": getattr(calibration, "empirical_coverage", None),
        "calibration_rows": getattr(calibration, "calibration_rows", None),
        "coverage_rows": getattr(calibration, "coverage_rows", None),
        "ratio": getattr(calibration, "ratio", None),
        "waiver": waiver.get("note") if isinstance(waiver, dict) else None,
      }
    )
  return rows


def spatial_rows(bundle: Any) -> list[dict[str, Any]] | None:
  summary = getattr(bundle, "evaluation_summary", None)
  if not isinstance(summary, dict):
    return None
  per_type = summary.get("perType", {})
  if not isinstance(per_type, dict):
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


def append_market_section(lines: list[str], *, title: str, bundle: Any | None, error: str | None, valuation_basis: str) -> None:
  lines.extend([f"## {title}", "", f"Valuation basis: **{valuation_basis}**.", ""])
  metrics = metrics_from_bundle(bundle) if bundle is not None else None
  strategy = (metrics or {}).get("validation_strategy", {}) if metrics else {}
  if strategy:
    lines.append(f"- Primary split: `{strategy.get('trainHoldoutSplit', 'not available')}`")
    if strategy.get("randomHoldoutSplit"):
      lines.append(f"- Secondary random split: `{strategy['randomHoldoutSplit']}`")
    if strategy.get("shippedModel"):
      lines.append(f"- Shipped model: `{strategy['shippedModel']}`")
    lines.append("")

  lines.extend(
    [
      "| Segment | Model | Temporal MAE | Temporal MAPE | Temporal R2 | N | Random MAE | Random MAPE |",
      "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
  )
  if metrics:
    for row in metrics["rows"]:
      lines.append(
        "| {segment} | {model} | ${mae} | {mape} | {r2} | {n} | {random_mae} | {random_mape} |".format(
          segment=row["segment"],
          model=row["model"],
          mae=format_number(row["mae"], 0),
          mape=format_percent(row["mape"]),
          r2=format_number(row["r2"], 3),
          n=format_number(row["n"], 0),
          random_mae=f"${format_number(row['random_mae'], 0)}" if row.get("random_mae") is not None else "not available",
          random_mape=format_percent(row.get("random_mape")),
        )
      )
  else:
    lines.append(f"| Metrics unavailable | — | — | — | — | — | — | {error or 'artifact missing'} |")

  lines.extend(["", "### Conformal coverage", ""])
  conformal = conformal_rows(bundle) if bundle is not None else None
  if conformal:
    lines.extend(
      [
        "| Segment | Target | Empirical | Calibration N | Coverage N | Waiver |",
        "|---|---:|---:|---:|---:|---|",
      ]
    )
    for row in conformal:
      lines.append(
        "| {segment} | {target} | {empirical} | {calibration_rows} | {coverage_rows} | {waiver} |".format(
          segment=row["segment"],
          target=format_percent(row["target_coverage"]),
          empirical=format_percent(row["empirical_coverage"]),
          calibration_rows=format_number(row["calibration_rows"], 0),
          coverage_rows=format_number(row["coverage_rows"], 0),
          waiver=row["waiver"] or "none",
        )
      )
  else:
    lines.append("Conformal coverage not available for this artifact.")

  lines.extend(["", "### Spatial generalization", ""])
  spatial = spatial_rows(bundle) if bundle is not None else None
  if spatial:
    lines.extend(["| Segment | Random CV MAE | Spatial CV MAE | Gap |", "|---|---:|---:|---:|"])
    for row in spatial:
      lines.append(
        "| {segment} | ${random_mae} | {spatial_mae} | {gap} |".format(
          segment=row["segment"],
          random_mae=format_number(row["random_cv_mae"], 0),
          spatial_mae=f"${format_number(row['spatial_cv_mae'], 0)}" if row["spatial_cv_mae"] is not None else "not run",
          gap=f"{format_number(row['gap_pct'], 1)}%" if row["gap_pct"] is not None else "not available",
        )
      )
  else:
    lines.append("Spatial generalization metrics not available for this artifact.")
  lines.append("")


def build_model_report() -> str:
  sys.path.insert(0, str(MODEL_SERVICE_DIR))
  from base_model.core import VancouverModelBundle
  from halifax_model.core import HalifaxModelBundle

  vancouver, vancouver_error = load_pickle_bundle(VANCOUVER_ARTIFACT, VancouverModelBundle, "Vancouver base-model")
  halifax, halifax_error = load_pickle_bundle(HALIFAX_ARTIFACT, HalifaxModelBundle, "Halifax base-model")

  lines = [
    "# Model Metrics Report",
    "",
    "Generated from approved pickle artifacts. Temporal metrics are primary when the bundle was trained under Phase E.",
    "",
  ]
  append_market_section(
    lines,
    title="Vancouver base-price model",
    bundle=vancouver,
    error=vancouver_error,
    valuation_basis="listing price",
  )
  append_market_section(
    lines,
    title="Halifax base-price model",
    bundle=halifax,
    error=halifax_error,
    valuation_basis="time-adjusted sale price",
  )

  lines.extend(
    [
      "## Limitations",
      "",
      "- Vancouver estimates listing price, not final sale price.",
      "- Halifax estimates time-adjusted sale price; condition and parcel-postal assignment remain imperfect.",
      "- Spatial CV gaps mean neighborhood memorization still matters; treat unseen FSAs cautiously.",
      "- Renovation uplift is a separate workflow and is not causal Vancouver proof.",
      "- Public Vercel deployment uses rules screening, not these fitted pickles.",
      "",
    ]
  )
  return "\n".join(lines)


def write_model_report(output_path: Path = DEFAULT_OUTPUT_PATH) -> Path:
  output_path.parent.mkdir(parents=True, exist_ok=True)
  output_path.write_text(build_model_report())
  return output_path


if __name__ == "__main__":
  path = write_model_report()
  print(f"Wrote {path}")
