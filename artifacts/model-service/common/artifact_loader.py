from __future__ import annotations

import hashlib
import json
import pickle
import sys
from pathlib import Path
from typing import Any, Callable, TypeVar


BundleT = TypeVar("BundleT")

MANIFEST_FILENAME = "MANIFEST.json"
HOLDOUT_ROW_FLOOR = 10
CONFORMAL_COVERAGE_FLOOR = 0.7
CONFORMAL_COVERAGE_WAIVER_FLOOR = 0.65


class ModelArtifactError(RuntimeError):
    """Raised when inference cannot load an approved immutable model artifact."""


def manifest_path_for(artifact_path: Path) -> Path:
    return artifact_path.parent / MANIFEST_FILENAME


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    if not manifest_path.is_file():
        raise ModelArtifactError(
            f"Artifact manifest is missing: {manifest_path}. "
            "Approved artifacts must be listed in MANIFEST.json with checksums."
        )
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ModelArtifactError(f"Artifact manifest {manifest_path.name} is not valid JSON.") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("artifacts"), list):
        raise ModelArtifactError(f"Artifact manifest {manifest_path.name} has an invalid schema.")
    return payload


def lookup_manifest_entry(manifest: dict[str, Any], filename: str) -> dict[str, Any] | None:
    for entry in manifest.get("artifacts", []):
        if isinstance(entry, dict) and entry.get("filename") == filename:
            return entry
    return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact_file:
        for chunk in iter(lambda: artifact_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_manifest_checksum(path: Path, entry: dict[str, Any]) -> None:
    expected = str(entry.get("sha256") or "")
    if not expected:
        raise ModelArtifactError(f"Manifest entry for {path.name} is missing sha256.")
    actual = sha256_file(path)
    if actual != expected:
        raise ModelArtifactError(
            f"Checksum mismatch for approved artifact {path.name}: "
            f"manifest sha256={expected[:12]}… but file sha256={actual[:12]}…"
        )
    expected_size = entry.get("sizeBytes")
    if expected_size is not None and path.stat().st_size != int(expected_size):
        raise ModelArtifactError(
            f"Size mismatch for approved artifact {path.name}: "
            f"manifest sizeBytes={expected_size} but file size={path.stat().st_size}."
        )


def verify_manifest_runtime_versions(entry: dict[str, Any], *, artifact_label: str) -> None:
    expected_sklearn = entry.get("sklearnVersion")
    if expected_sklearn:
        sklearn_version = _runtime_package_version("sklearn")
        if sklearn_version != expected_sklearn:
            raise ModelArtifactError(
                f"Approved {artifact_label} artifact {entry.get('filename')} requires scikit-learn "
                f"{expected_sklearn}, but the runtime has {sklearn_version}."
            )


def _runtime_package_version(module_name: str) -> str:
    module = __import__(module_name)
    return str(getattr(module, "__version__", "unknown"))


def extract_feature_names(bundle: Any) -> list[str] | None:
    models = getattr(bundle, "models", None)
    if not isinstance(models, dict) or not models:
        return None
    first_model = next(iter(models.values()))
    prep = getattr(first_model, "named_steps", {}).get("prep")
    if prep is None or not hasattr(prep, "get_feature_names_out"):
        return None
    return [str(name) for name in prep.get_feature_names_out()]


def extended_bundle_validation_issues(
    bundle: Any,
    *,
    expected_model_version: str,
    expected_location_feature_version: str | None = None,
    manifest_entry: dict[str, Any] | None = None,
) -> list[str]:
    issues: list[str] = []
    if getattr(bundle, "model_version", None) != expected_model_version:
        issues.append(f"model version must be {expected_model_version}")
    if not getattr(bundle, "models", None):
        issues.append("fitted models are missing")
    if not getattr(bundle, "conformal_calibrations", None):
        issues.append("conformal calibrations are missing")
    if expected_location_feature_version is not None:
        if getattr(bundle, "location_feature_version", None) != expected_location_feature_version:
            issues.append(f"location feature version must be {expected_location_feature_version}")

    feature_names = extract_feature_names(bundle)
    if not feature_names:
        issues.append("feature-name list is missing")

    evaluation_summary = getattr(bundle, "evaluation_summary", None)
    per_type = evaluation_summary.get("perType", {}) if isinstance(evaluation_summary, dict) else {}
    if isinstance(per_type, dict):
        for property_type, details in per_type.items():
            if not isinstance(details, dict):
                continue
            holdout = details.get("holdout", {})
            holdout_rows = int(holdout.get("rows") or 0) if isinstance(holdout, dict) else 0
            if holdout_rows < HOLDOUT_ROW_FLOOR:
                issues.append(
                    f"{property_type} holdout row count {holdout_rows} is below floor {HOLDOUT_ROW_FLOOR}"
                )

    calibrations = getattr(bundle, "conformal_calibrations", None)
    waivers = getattr(bundle, "conformal_coverage_waivers", None) or {}
    if isinstance(calibrations, dict):
        for property_type, calibration in calibrations.items():
            empirical_coverage = getattr(calibration, "empirical_coverage", None)
            if empirical_coverage is not None and float(empirical_coverage) < CONFORMAL_COVERAGE_FLOOR:
                waiver = waivers.get(property_type) if isinstance(waivers, dict) else None
                waived_floor = float(waiver.get("waivedFloor", 0)) if isinstance(waiver, dict) else 0.0
                if isinstance(waiver, dict) and float(empirical_coverage) >= waived_floor:
                    continue
                issues.append(
                    f"{property_type} conformal empirical coverage {float(empirical_coverage):.3f} "
                    f"is below floor {CONFORMAL_COVERAGE_FLOOR}"
                )

    if manifest_entry:
        expected_bundle_version = manifest_entry.get("modelVersion")
        if expected_bundle_version and getattr(bundle, "model_version", None) != expected_bundle_version:
            issues.append(
                f"bundle model version {getattr(bundle, 'model_version', None)!r} "
                f"does not match manifest {expected_bundle_version!r}"
            )

    return issues


def build_manifest_entry(
    artifact_path: Path,
    *,
    model_version: str,
    trained_at: str,
    status: str = "approved",
) -> dict[str, Any]:
    xgboost_version: str | None
    try:
        import xgboost

        xgboost_version = str(xgboost.__version__)
    except Exception:
        xgboost_version = None

    return {
        "filename": artifact_path.name,
        "sha256": sha256_file(artifact_path),
        "sizeBytes": artifact_path.stat().st_size,
        "modelVersion": model_version,
        "trainedAt": trained_at,
        "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "sklearnVersion": _runtime_package_version("sklearn"),
        "xgboostVersion": xgboost_version,
        "status": status,
    }


def upsert_manifest_entry(artifact_path: Path, entry: dict[str, Any]) -> Path:
    manifest_path = manifest_path_for(artifact_path)
    if manifest_path.is_file():
        manifest = load_manifest(manifest_path)
    else:
        manifest = {"schemaVersion": 1, "artifacts": []}

    artifacts = [item for item in manifest.get("artifacts", []) if item.get("filename") != entry["filename"]]
    artifacts.append(entry)
    manifest["artifacts"] = artifacts
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def load_approved_pickle(
    path: Path,
    *,
    expected_type: type[BundleT],
    artifact_label: str,
    validate: Callable[[BundleT], list[str]],
) -> BundleT:
    """Load and validate a trusted local artifact without training or repairing it."""

    if not path.is_file():
        raise ModelArtifactError(
            f"Approved {artifact_label} artifact is missing: {path.name}. "
            "Inference never trains models; run the offline training command and deploy the resulting artifact."
        )

    manifest_path = manifest_path_for(path)
    manifest = load_manifest(manifest_path)
    entry = lookup_manifest_entry(manifest, path.name)
    if entry is None:
        raise ModelArtifactError(
            f"Approved {artifact_label} artifact {path.name} is not listed in {manifest_path.name}."
        )
    if entry.get("status") != "approved":
        raise ModelArtifactError(
            f"Approved {artifact_label} artifact {path.name} has manifest status {entry.get('status')!r}."
        )

    verify_manifest_checksum(path, entry)
    verify_manifest_runtime_versions(entry, artifact_label=artifact_label)

    try:
        with path.open("rb") as artifact_file:
            bundle = pickle.load(artifact_file)
    except Exception as error:
        raise ModelArtifactError(
            f"Approved {artifact_label} artifact {path.name} could not be loaded: {type(error).__name__}."
        ) from error

    if not isinstance(bundle, expected_type):
        raise ModelArtifactError(
            f"Approved {artifact_label} artifact {path.name} has an unexpected bundle type."
        )

    issues = validate(bundle)
    if issues:
        raise ModelArtifactError(
            f"Approved {artifact_label} artifact {path.name} failed validation: {'; '.join(issues)}."
        )

    return bundle
