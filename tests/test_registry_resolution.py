"""Tests for registry-driven load_bundle() resolution and its safe fallbacks.

These mock the registry (no real MLflow round-trip, no real model bundles), so they exercise the
control flow: registry -> local artifact -> train, plus the force_retrain and disabled paths.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
if str(MODEL_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_SERVICE_DIR))

import base_model.core as core  # noqa: E402
from common import registry  # noqa: E402


def _fake_bundle(data_path: str) -> SimpleNamespace:
    # SimpleNamespace accepts the transient registry_* / market_index_path attributes load_bundle sets.
    return SimpleNamespace(data_path=data_path, conformal_calibrations={"Condo": object()})


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch, tmp_path):
    core._BUNDLE = None
    registry.clear_cache()
    # A real on-disk artifact so the local-fallback branch's ARTIFACT_PATH.exists() is True.
    artifact = tmp_path / "bundle.pkl"
    artifact.write_bytes(b"placeholder")
    monkeypatch.setattr(core, "ARTIFACT_PATH", artifact)
    yield
    core._BUNDLE = None


def test_uses_registry_when_enabled(monkeypatch):
    resolved = SimpleNamespace(
        local_path=Path("/tmp/whatever.pkl"),
        version="7",
        stage="Production",
        architecture="pooled-features",
        run_id="abc",
    )
    fake_registry = SimpleNamespace(
        registry_enabled=lambda: True,
        resolve_production=lambda name: resolved,
    )
    monkeypatch.setattr(core, "model_registry", fake_registry)
    monkeypatch.setattr(core, "_load_pickle_safe", lambda path: _fake_bundle(core.DEFAULT_DATA_PATH))
    monkeypatch.setattr(core, "train_bundle", lambda **kwargs: pytest.fail("must not train"))

    bundle = core.load_bundle()
    assert bundle.registry_version == "7"
    assert bundle.registry_stage == "Production"


def test_falls_back_to_local_when_registry_returns_none(monkeypatch):
    fake_registry = SimpleNamespace(
        registry_enabled=lambda: True,
        resolve_production=lambda name: None,
    )
    monkeypatch.setattr(core, "model_registry", fake_registry)
    monkeypatch.setattr(core, "_load_pickle_safe", lambda path: _fake_bundle(core.DEFAULT_DATA_PATH))
    monkeypatch.setattr(core, "train_bundle", lambda **kwargs: pytest.fail("must not train"))

    bundle = core.load_bundle()
    assert bundle.registry_version is None
    assert bundle.registry_stage is None


def test_registry_not_consulted_when_disabled(monkeypatch):
    calls = {"resolve": 0}

    def _resolve(name):
        calls["resolve"] += 1
        return None

    fake_registry = SimpleNamespace(registry_enabled=lambda: False, resolve_production=_resolve)
    monkeypatch.setattr(core, "model_registry", fake_registry)
    monkeypatch.setattr(core, "_load_pickle_safe", lambda path: _fake_bundle(core.DEFAULT_DATA_PATH))
    monkeypatch.setattr(core, "train_bundle", lambda **kwargs: pytest.fail("must not train"))

    bundle = core.load_bundle()
    assert calls["resolve"] == 0  # disabled => never touched
    assert bundle.registry_version is None


def test_force_retrain_skips_registry_and_local(monkeypatch):
    calls = {"resolve": 0}

    def _resolve(name):
        calls["resolve"] += 1
        return SimpleNamespace(local_path=Path("x"), version="1", stage="Production", architecture="a", run_id="r")

    fake_registry = SimpleNamespace(registry_enabled=lambda: True, resolve_production=_resolve)
    monkeypatch.setattr(core, "model_registry", fake_registry)
    monkeypatch.setattr(core, "_load_pickle_safe", lambda path: pytest.fail("must not load pickle"))
    monkeypatch.setattr(core, "train_bundle", lambda **kwargs: "TRAINED")

    result = core.load_bundle(force_retrain=True)
    assert result == "TRAINED"
    assert calls["resolve"] == 0


def test_pre_v5_pickle_rejected_triggers_fallback(monkeypatch):
    # A bundle without conformal_calibrations must be rejected by _load_pickle_safe -> train.
    fake_registry = SimpleNamespace(registry_enabled=lambda: False, resolve_production=lambda name: None)
    monkeypatch.setattr(core, "model_registry", fake_registry)
    monkeypatch.setattr(core, "_load_pickle_safe", lambda path: None)  # simulates rejection
    monkeypatch.setattr(core, "train_bundle", lambda **kwargs: "TRAINED")

    assert core.load_bundle() == "TRAINED"


def test_resolve_production_returns_none_when_disabled():
    # conftest clears MODEL_REGISTRY_ENABLED, so the registry is disabled and resolve never raises.
    registry.clear_cache()
    assert registry.registry_enabled() is False
    assert registry.resolve_production("vancouver-base-price") is None
