"""Resolve which trained bundle the MLflow Model Registry says is in Production.

Serving uses this to load the registry's Production-stage model instead of a hardcoded path,
so the architecture the promotion policy selected (by spatial CV MAE) is the one that actually
serves. It is import-guarded and **never raises**: when MLflow is unavailable, the registry is
disabled, or no Production version exists, `resolve_production` returns None and the caller falls
back to the local committed bundle. Registration is reference-only — the registry stores the local
bundle path; this resolver just reads it, so no artifact download happens at request time.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

try:
    from common import mlflow_tracking
except Exception:  # pragma: no cover - helper is optional
    mlflow_tracking = None


@dataclass
class ResolvedModel:
    local_path: Path
    version: str
    stage: str
    architecture: str
    run_id: Optional[str]


# One resolution per process: serving resolves once, then the core's _BUNDLE singleton serves.
_RESOLUTION_CACHE: Dict[str, Optional[ResolvedModel]] = {}


def registry_enabled() -> bool:
    """Default OFF. Only ON when MLflow is installed AND MODEL_REGISTRY_ENABLED=1.

    This is the guard that keeps CI, offline dev, and the Vercel build on the current behavior:
    an empty/missing registry is indistinguishable from 'disabled' at the serving layer.
    """
    return (
        mlflow_tracking is not None
        and mlflow_tracking.available()
        and os.environ.get("MODEL_REGISTRY_ENABLED") == "1"
    )


def resolve_production(model_name: str, *, use_cache: bool = True) -> Optional[ResolvedModel]:
    """Return the Production-stage version's local bundle reference, or None on any failure."""
    if not registry_enabled():
        return None
    if use_cache and model_name in _RESOLUTION_CACHE:
        return _RESOLUTION_CACHE[model_name]

    resolved: Optional[ResolvedModel] = None
    try:
        mlflow_tracking.configure(mlflow_tracking.EXPERIMENT_PROD)
        client = mlflow_tracking.client()
        versions = client.get_latest_versions(model_name, stages=["Production"])
        if versions:
            model_version = versions[0]
            tags = dict(model_version.tags or {})
            local_path = tags.get("artifact_path") or model_version.source
            if local_path and Path(local_path).exists():
                resolved = ResolvedModel(
                    local_path=Path(local_path),
                    version=str(model_version.version),
                    stage="Production",
                    architecture=tags.get("architecture", "local-per-type"),
                    run_id=getattr(model_version, "run_id", None),
                )
    except Exception:
        resolved = None

    if use_cache:
        _RESOLUTION_CACHE[model_name] = resolved
    return resolved


def clear_cache() -> None:
    _RESOLUTION_CACHE.clear()
