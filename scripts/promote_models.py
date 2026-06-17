"""Promote the best registered model version to Production, by a documented, reproducible policy.

Policy (a pure function of logged metrics + the constants below):
- Primary metric: spatial_cv_mae (lower wins) — GroupKFold-by-FSA spatial generalization, the
  failure mode that matters for valuation. This is exactly the metric the experiment lab found
  pooled models win on, so the registry promotes the architecture the lab proved best.
- Guardrail: a candidate may not regress holdout_mape vs the incumbent Production version by more
  than REGRESSION_TOLERANCE — prevents promoting a spatially-smooth but globally-worse model.

Promotion is per registered model (per market). Then the registry snapshot is refreshed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
SCRIPTS_DIR = REPO_ROOT / "scripts"
for path in (str(MODEL_SERVICE_DIR), str(SCRIPTS_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from common import mlflow_tracking  # noqa: E402
import export_registry_snapshot  # noqa: E402

PRIMARY_METRIC = "spatial_cv_mae"  # lower is better
GUARDRAIL_METRIC = "holdout_mape"
REGRESSION_TOLERANCE = 0.02  # candidate may not be worse than incumbent by more than 2 pp MAPE
MODEL_NAMES = {"vancouver": "vancouver-base-price", "halifax": "halifax-base-price"}


def _float_tag(tags: Dict[str, str], key: str) -> Optional[float]:
    value = tags.get(key)
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _version_records(client: Any, name: str) -> List[Dict[str, Any]]:
    records = []
    for model_version in client.search_model_versions(f"name='{name}'"):
        tags = dict(model_version.tags or {})
        records.append(
            {
                "version": model_version.version,
                "stage": model_version.current_stage,
                "architecture": tags.get("architecture"),
                "model_version": tags.get("model_version"),
                "spatial_cv_mae": _float_tag(tags, "spatial_cv_mae"),
                "holdout_mae": _float_tag(tags, "holdout_mae"),
                "holdout_mape": _float_tag(tags, "holdout_mape"),
            }
        )
    return records


def promote(name: str, client: Any, dry_run: bool) -> Optional[Dict[str, Any]]:
    records = _version_records(client, name)
    if not records:
        print(f"  {name}: no versions registered; skipping")
        return None
    candidates = [record for record in records if record["spatial_cv_mae"] is not None]
    if not candidates:
        print(f"  {name}: no versions expose {PRIMARY_METRIC}; skipping")
        return None

    incumbent = next((record for record in records if record["stage"] == "Production"), None)
    best = min(candidates, key=lambda record: record["spatial_cv_mae"])

    if incumbent and incumbent["version"] == best["version"]:
        print(
            f"  {name}: v{best['version']} ({best['architecture']}) already Production; "
            f"{PRIMARY_METRIC}=${best['spatial_cv_mae']:,.0f}"
        )
        return best

    if incumbent and best["holdout_mape"] is not None and incumbent["holdout_mape"] is not None:
        if best["holdout_mape"] > incumbent["holdout_mape"] + REGRESSION_TOLERANCE:
            print(
                f"  {name}: candidate v{best['version']} ({best['architecture']}) BLOCKED by guardrail — "
                f"{GUARDRAIL_METRIC} {best['holdout_mape']:.3f} > incumbent {incumbent['holdout_mape']:.3f} "
                f"+ {REGRESSION_TOLERANCE}; keeping v{incumbent['version']}"
            )
            return incumbent

    decision = (
        f"  {name}: promote v{best['version']} ({best['architecture']}, {best['model_version']}) "
        f"— {PRIMARY_METRIC}=${best['spatial_cv_mae']:,.0f}"
    )
    if incumbent:
        decision += f" (was v{incumbent['version']} {incumbent['architecture']}, ${incumbent['spatial_cv_mae']:,.0f})"
    print(decision + ("  [dry-run]" if dry_run else ""))
    if not dry_run:
        mlflow_tracking.transition_stage(name, best["version"], "Production", archive_existing=True)
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print decisions without transitioning.")
    parser.add_argument("--market", choices=["vancouver", "halifax", "all"], default="all")
    args = parser.parse_args()

    if not mlflow_tracking.available():
        print("MLflow is not installed; nothing to promote.")
        return

    mlflow_tracking.configure(mlflow_tracking.EXPERIMENT_PROD)
    client = mlflow_tracking.client()
    names = [MODEL_NAMES[args.market]] if args.market != "all" else list(MODEL_NAMES.values())

    print(
        f"Promotion policy: lowest {PRIMARY_METRIC} wins; guardrail: {GUARDRAIL_METRIC} regression "
        f"<= {REGRESSION_TOLERANCE} vs incumbent Production.\n"
    )
    for name in names:
        promote(name, client, args.dry_run)

    if not args.dry_run:
        snapshot = export_registry_snapshot.write_snapshot()
        print(
            f"\nRefreshed {export_registry_snapshot.DEFAULT_SNAPSHOT_PATH} "
            f"(status={snapshot['status']}, {len(snapshot.get('models', []))} model(s))."
        )


if __name__ == "__main__":
    main()
