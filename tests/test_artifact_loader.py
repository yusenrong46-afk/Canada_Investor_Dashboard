from __future__ import annotations

import json
import pickle
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
