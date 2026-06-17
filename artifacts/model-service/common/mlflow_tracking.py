"""Shared, optional MLflow tracking + model-registry helper.

Both the experiment lab (`scripts/run_model_experiments.py`) and the production
training pipelines (`base_model`/`halifax_model` `train_bundle`) use this module so
their runs land in one local, SQLite-backed MLflow store that supports the Model
Registry. Everything here is a **no-op when MLflow is not installed** (mirroring the
`xgboost`/`shap` import guards elsewhere), so importing it never couples the rest of
the pipeline to a new dependency.

Design choices that matter:
- Tracking store is SQLite (`mlflow/tracking.db`) because the Model Registry requires a
  database-backed store. The `.db` is tiny (metrics/params/tags only) and committed so a
  reviewer can `mlflow ui` with full history; the file artifact store (`mlflow/artifacts`)
  is gitignored, like the existing `.pkl` bundles.
- Bundles (~10-70 MB pickles) are logged **by reference** (path + sha256 + size as params
  and model-version tags), never copied into the artifact store by default. The registry
  records *which* local bundle is Production; serving loads that local pickle. Set
  `MLFLOW_LOG_BUNDLE_ARTIFACT=1` to additionally copy the bundle as a real artifact (for a
  one-off "model lineage" screenshot).
- All paths resolve from the repo root derived from `__file__`, never the cwd, because the
  build steps run as subprocesses from the repo root.
"""

from __future__ import annotations

import contextlib
import hashlib
import math
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
MLFLOW_DIR = REPO_ROOT / "mlflow"
DEFAULT_TRACKING_DB = MLFLOW_DIR / "tracking.db"
DEFAULT_ARTIFACT_DIR = MLFLOW_DIR / "artifacts"

# Stable experiment names so screenshots and queries are predictable.
EXPERIMENT_LAB = "property-valuation-lab"
EXPERIMENT_PROD = "property-valuation-production"

# Registered model names (per market). The hand-rolled "-vN" version string becomes a tag;
# the registry's own integer version supersedes it.
REGISTERED_MODEL_NAMES = {
    "vancouver": "vancouver-base-price",
    "halifax_maritimes": "halifax-base-price",
}

_HELPER_VERSION = "v1"
_MAX_PARAM_CHARS = 480  # MLflow rejects params longer than 500 chars.

try:  # pragma: no cover - exercised by both the installed and missing-dependency paths
    import mlflow
    from mlflow.tracking import MlflowClient

    MLFLOW_AVAILABLE = True
    MLFLOW_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - depends on local install
    mlflow = None
    MlflowClient = None
    MLFLOW_AVAILABLE = False
    MLFLOW_IMPORT_ERROR = str(exc)


def available() -> bool:
    return MLFLOW_AVAILABLE


def tracking_uri() -> str:
    """The active tracking URI. Tests/CI can override via the standard MLFLOW_TRACKING_URI."""
    return os.environ.get("MLFLOW_TRACKING_URI") or f"sqlite:///{DEFAULT_TRACKING_DB}"


def artifact_location() -> str:
    return os.environ.get("MLFLOW_ARTIFACT_LOCATION") or f"file://{DEFAULT_ARTIFACT_DIR}"


def training_logging_enabled() -> bool:
    """True only when a deliberate training run asked for logging.

    Set by `scripts/train_production_bundles.py`. Kept OFF by default so a serving-path
    fallback retrain (load_bundle -> train_bundle) never logs to or registers in MLflow.
    """
    return MLFLOW_AVAILABLE and os.environ.get("MLFLOW_LOG_TRAINING") == "1"


def _ensure_local_dirs() -> None:
    # Only create the committed local store when no external store was configured.
    if not os.environ.get("MLFLOW_TRACKING_URI"):
        MLFLOW_DIR.mkdir(parents=True, exist_ok=True)
        DEFAULT_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


def configure(experiment_name: str) -> Optional[str]:
    """Point MLflow at the local store and select/create the experiment. Returns its id."""
    if not MLFLOW_AVAILABLE:
        return None
    _ensure_local_dirs()
    mlflow.set_tracking_uri(tracking_uri())
    existing = mlflow.get_experiment_by_name(experiment_name)
    if existing is None:
        mlflow.create_experiment(experiment_name, artifact_location=artifact_location())
    mlflow.set_experiment(experiment_name)
    experiment = mlflow.get_experiment_by_name(experiment_name)
    return experiment.experiment_id if experiment is not None else None


def _git_sha() -> Optional[str]:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        return None
    return None


def _lib_version(module_name: str) -> Optional[str]:
    try:
        module = __import__(module_name)
        return getattr(module, "__version__", None)
    except Exception:
        return None


def common_tags(extra: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    """Provenance tags attached to every run so 'why won't this load' is diagnosable."""
    tags: Dict[str, str] = {
        "repo": "canadian-investor-dashboard",
        "mlflow_helper_version": _HELPER_VERSION,
    }
    sha = _git_sha()
    if sha:
        tags["git_sha"] = sha
        tags["git_sha7"] = sha[:7]
    for name in ("sklearn", "numpy", "xgboost", "pandas"):
        version = _lib_version(name)
        if version:
            tags[f"{name}_version"] = version
    if extra:
        for key, value in extra.items():
            if value is not None:
                tags[key] = _stringify(value)
    return tags


def _stringify(value: Any) -> str:
    text = value if isinstance(value, str) else str(value)
    if len(text) > _MAX_PARAM_CHARS:
        return text[: _MAX_PARAM_CHARS - 1] + "…"
    return text


def _is_finite_number(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


@contextlib.contextmanager
def start_run(
    run_name: Optional[str] = None,
    *,
    nested: bool = False,
    tags: Optional[Dict[str, Any]] = None,
) -> Iterator[Any]:
    """Context manager around mlflow.start_run; yields None when MLflow is unavailable."""
    if not MLFLOW_AVAILABLE:
        yield None
        return
    clean_tags = {key: _stringify(val) for key, val in (tags or {}).items() if val is not None}
    with mlflow.start_run(run_name=run_name, nested=nested, tags=clean_tags or None) as run:
        yield run


def log_params(params: Dict[str, Any]) -> None:
    if not MLFLOW_AVAILABLE or not params:
        return
    clean = {key: _stringify(val) for key, val in params.items() if val is not None}
    if clean:
        mlflow.log_params(clean)


def log_metrics(metrics: Dict[str, Any], step: Optional[int] = None) -> None:
    if not MLFLOW_AVAILABLE or not metrics:
        return
    clean = {key: float(val) for key, val in metrics.items() if _is_finite_number(val)}
    if not clean:
        return
    if step is None:
        mlflow.log_metrics(clean)
    else:
        mlflow.log_metrics(clean, step=step)


def set_tags(tags: Dict[str, Any]) -> None:
    if not MLFLOW_AVAILABLE or not tags:
        return
    clean = {key: _stringify(val) for key, val in tags.items() if val is not None}
    if clean:
        mlflow.set_tags(clean)


def log_dict_artifact(obj: Any, artifact_file: str) -> None:
    if not MLFLOW_AVAILABLE:
        return
    try:
        mlflow.log_dict(obj, artifact_file)
    except Exception:
        pass


def file_sha256(path: Path) -> Optional[str]:
    path = Path(path)
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def log_bundle_reference(
    path: Path,
    *,
    sha256: Optional[str] = None,
    bytes_: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Log a bundle's path/sha/size as params (no copy). Returns the reference dict.

    Copies the bundle as a real artifact only when MLFLOW_LOG_BUNDLE_ARTIFACT=1.
    """
    path = Path(path)
    sha = sha256 if sha256 is not None else file_sha256(path)
    size = bytes_ if bytes_ is not None else (path.stat().st_size if path.exists() else None)
    reference = {"artifact_path": str(path), "bundle_sha256": sha, "bundle_bytes": size}
    if extra:
        reference.update(extra)
    log_params(reference)
    if MLFLOW_AVAILABLE and os.environ.get("MLFLOW_LOG_BUNDLE_ARTIFACT") == "1" and path.exists():
        try:
            mlflow.log_artifact(str(path), artifact_path="bundle")
        except Exception:
            pass
    return reference


def client() -> Optional[Any]:
    if not MLFLOW_AVAILABLE:
        return None
    return MlflowClient(tracking_uri=tracking_uri())


def register_model(
    run_id: str,
    *,
    name: str,
    source: str,
    tags: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Register a model version that *references* a local bundle path.

    `source` is the local bundle path; the version tags carry artifact_path/sha/architecture
    so the serving resolver can load the local pickle without downloading anything.
    New versions land in stage `None` — promotion is a separate, explicit step.
    """
    if not MLFLOW_AVAILABLE:
        return None
    registry = client()
    try:
        registry.create_registered_model(name)
    except Exception:
        pass  # already exists
    clean_tags = {key: _stringify(val) for key, val in (tags or {}).items() if val is not None}
    version = registry.create_model_version(
        name=name,
        source=source,
        run_id=run_id,
        tags=clean_tags or None,
    )
    return version.version


def transition_stage(
    name: str,
    version: Any,
    stage: str,
    *,
    archive_existing: bool = True,
) -> None:
    if not MLFLOW_AVAILABLE:
        return
    client().transition_model_version_stage(
        name=name,
        version=str(version),
        stage=stage,
        archive_existing_versions=archive_existing,
    )
