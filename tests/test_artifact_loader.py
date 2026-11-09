from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from common.artifact_loader import (  # noqa: E402
    ModelArtifactError,
    build_manifest_entry,
    load_approved_pickle,
    sha256_file,
    upsert_manifest_entry,
)


def test_tampered_pickle_fails_checksum_verification(tmp_path: Path) -> None:
    from base_model import core

    source = core.ARTIFACT_PATH
    if not source.is_file():
        pytest.skip("local Vancouver bundle not present")

    artifact_path = tmp_path / source.name
    artifact_path.write_bytes(source.read_bytes())
    upsert_manifest_entry(
        artifact_path,
        build_manifest_entry(
            artifact_path,
            model_version=core.MODEL_VERSION,
            trained_at="2026-01-01T00:00:00Z",
        ),
    )

    data = bytearray(artifact_path.read_bytes())
    data[-1] ^= 0x01
    artifact_path.write_bytes(bytes(data))

    with pytest.raises(ModelArtifactError, match="Checksum mismatch"):
        load_approved_pickle(
            artifact_path,
            expected_type=core.VancouverModelBundle,
            artifact_label="Vancouver base-model",
            validate=core._bundle_validation_issues,
        )


def test_missing_manifest_entry_is_rejected(tmp_path: Path) -> None:
    from base_model import core

    artifact_path = tmp_path / "vancouver_base_price_bundle_v5.pkl"
    artifact_path.write_bytes(b"not-a-real-bundle")
    (tmp_path / "MANIFEST.json").write_text(json.dumps({"schemaVersion": 1, "artifacts": []}))

    with pytest.raises(ModelArtifactError, match="is not listed"):
        load_approved_pickle(
            artifact_path,
            expected_type=core.VancouverModelBundle,
            artifact_label="Vancouver base-model",
            validate=core._bundle_validation_issues,
        )


def test_manifest_entry_records_expected_sha256(tmp_path: Path) -> None:
    artifact_path = tmp_path / "fixture.pkl"
    artifact_path.write_bytes(b"fixture-bytes")
    entry = build_manifest_entry(
        artifact_path,
        model_version="fixture-v1",
        trained_at="2026-01-01T00:00:00Z",
    )
    assert entry["sha256"] == sha256_file(artifact_path)
    assert entry["sizeBytes"] == len(b"fixture-bytes")


def test_failed_load_is_memoized_until_artifact_changes(tmp_path: Path, monkeypatch) -> None:
    from base_model import core
    from common import artifact_loader

    artifact_path = tmp_path / "vancouver_base_price_bundle_v5.pkl"
    artifact_path.write_bytes(b"not-a-real-bundle")
    upsert_manifest_entry(
        artifact_path,
        build_manifest_entry(artifact_path, model_version=core.MODEL_VERSION, trained_at="2026-01-01T00:00:00Z"),
    )
    hashes = []
    real_sha256 = artifact_loader.sha256_file
    monkeypatch.setattr(artifact_loader, "sha256_file", lambda path: hashes.append(path) or real_sha256(path))

    def _load():
        return load_approved_pickle(
            artifact_path,
            expected_type=core.VancouverModelBundle,
            artifact_label="Vancouver base-model",
            validate=core._bundle_validation_issues,
        )

    for _ in range(3):
        with pytest.raises(ModelArtifactError, match="could not be loaded"):
            _load()
    assert len(hashes) == 1

    artifact_path.write_bytes(b"still-not-a-real-bundle")
    with pytest.raises(ModelArtifactError, match="Checksum mismatch"):
        _load()
    assert len(hashes) == 2


def test_missing_manifest_message_has_no_absolute_path(tmp_path: Path) -> None:
    from base_model import core

    artifact_path = tmp_path / "vancouver_base_price_bundle_v5.pkl"
    artifact_path.write_bytes(b"bytes")

    with pytest.raises(ModelArtifactError, match="manifest is missing") as excinfo:
        load_approved_pickle(
            artifact_path,
            expected_type=core.VancouverModelBundle,
            artifact_label="Vancouver base-model",
            validate=core._bundle_validation_issues,
        )
    assert str(tmp_path) not in str(excinfo.value)


def test_xgboost_version_mismatch_warns_without_failing(monkeypatch) -> None:
    from common import artifact_loader

    real_version = artifact_loader._runtime_package_version
    monkeypatch.setattr(
        artifact_loader,
        "_runtime_package_version",
        lambda module: "0.0.1" if module == "xgboost" else real_version(module),
    )
    entry = {
        "filename": "bundle.pkl",
        "sklearnVersion": real_version("sklearn"),
        "xgboostVersion": "3.2.0",
    }

    with pytest.warns(RuntimeWarning, match="xgboost 3.2.0, but the runtime has 0.0.1"):
        artifact_loader.verify_manifest_runtime_versions(entry, artifact_label="test")
