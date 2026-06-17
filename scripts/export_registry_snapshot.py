"""Export a small, committed snapshot of the MLflow Model Registry's Production state.

Writes `data/exports/model_registry.json` — a NEW file (not an edit to model_experiments.json,
whose schema forbids extra keys). The snapshot is what the API/frontend can read to show which
model/architecture is in Production, and it is also the offline selection input for serving on the
hosted site (where MLflow itself does not run).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
if str(MODEL_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_SERVICE_DIR))

from common import mlflow_tracking  # noqa: E402

DEFAULT_SNAPSHOT_PATH = REPO_ROOT / "data" / "exports" / "model_registry.json"
MODEL_TO_MARKET = {"vancouver-base-price": "vancouver", "halifax-base-price": "halifax_maritimes"}
POLICY = {
    "primaryMetric": "spatialCvMae",
    "direction": "lower-is-better",
    "guardrail": "holdoutMape may not regress more than 0.02 vs the incumbent Production version",
    "rationale": "GroupKFold-by-FSA spatial CV measures generalization to unseen postal areas, the "
    "failure mode that matters for valuation — so we do not reward a model that memorized FSAs.",
}


def _float_tag(tags: Dict[str, str], key: str) -> Optional[float]:
    value = tags.get(key)
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def build_snapshot(generated_at: str) -> Dict[str, Any]:
    if not mlflow_tracking.available():
        return {"status": "unavailable", "message": "MLflow is not installed", "generatedAt": generated_at}
    mlflow_tracking.configure(mlflow_tracking.EXPERIMENT_PROD)
    client = mlflow_tracking.client()
    models = []
    for name, market in MODEL_TO_MARKET.items():
        try:
            production = client.get_latest_versions(name, stages=["Production"])
        except Exception:
            production = []
        if not production:
            continue
        model_version = production[0]
        tags = dict(model_version.tags or {})
        models.append(
            {
                "name": name,
                "market": market,
                "productionVersion": int(model_version.version),
                "modelVersionTag": tags.get("model_version"),
                "stage": model_version.current_stage,
                "modelArchitecture": tags.get("architecture"),
                "spatialCvMae": _float_tag(tags, "spatial_cv_mae"),
                "holdoutMae": _float_tag(tags, "holdout_mae"),
                "holdoutMape": _float_tag(tags, "holdout_mape"),
                "runId": getattr(model_version, "run_id", None),
            }
        )
    return {
        "status": "ready" if models else "unavailable",
        "generatedAt": generated_at,
        # Repo-relative display so the committed snapshot does not leak an absolute machine path.
        "trackingStore": "sqlite:///mlflow/tracking.db",
        "policy": POLICY,
        "models": models,
    }


def write_snapshot(path: Path = DEFAULT_SNAPSHOT_PATH, generated_at: Optional[str] = None) -> Dict[str, Any]:
    generated_at = generated_at or datetime.now(timezone.utc).isoformat()
    snapshot = build_snapshot(generated_at)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=2) + "\n")
    return snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(DEFAULT_SNAPSHOT_PATH))
    args = parser.parse_args()
    snapshot = write_snapshot(Path(args.out))
    print(f"Wrote {args.out} (status={snapshot['status']}, {len(snapshot.get('models', []))} model(s))")


if __name__ == "__main__":
    main()
