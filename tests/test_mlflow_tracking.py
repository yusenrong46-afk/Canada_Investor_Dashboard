"""Tests for the MLflow tracking helper, lab logging, and the promotion policy.

The session-wide conftest fixture redirects MLflow to a throwaway SQLite store, so these never
touch the committed mlflow/tracking.db.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
SCRIPTS_DIR = REPO_ROOT / "scripts"
for _path in (str(MODEL_SERVICE_DIR), str(SCRIPTS_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

pytest.importorskip("mlflow")

from common import mlflow_tracking as mt  # noqa: E402
from scripts.build_property_warehouse import build_property_warehouse  # noqa: E402
from scripts.run_model_experiments import EXPERIMENTS, run_model_experiments  # noqa: E402
from tests.test_property_warehouse import _small_halifax_training_frame, _small_vancouver_training_frame  # noqa: E402


def _replicated(base: pd.DataFrame, copies: int) -> pd.DataFrame:
    frames = []
    for index in range(copies):
        frame = base.copy()
        frame["price"] = (frame["price"] * (1.0 + 0.004 * (index % 23))).round(0)
        frame["livingAreaSqft"] = frame["livingAreaSqft"] + (index % 11) * 6
        frame["logPrice"] = np.log1p(frame["price"])
        frame["pricePerSqft"] = (frame["price"] / frame["livingAreaSqft"]).round(2)
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)


def test_configure_is_idempotent() -> None:
    first = mt.configure(mt.EXPERIMENT_PROD)
    second = mt.configure(mt.EXPERIMENT_PROD)
    assert first is not None
    assert first == second


def test_log_metrics_drops_none_and_nan() -> None:
    mt.configure(mt.EXPERIMENT_PROD)
    with mt.start_run(run_name="metrics-unit") as run:
        mt.log_metrics({"good": 1.5, "none_value": None, "nan_value": float("nan")})
        run_id = run.info.run_id
    metrics = mt.client().get_run(run_id).data.metrics
    assert metrics.get("good") == 1.5
    assert "none_value" not in metrics
    assert "nan_value" not in metrics


def test_common_tags_include_provenance() -> None:
    tags = mt.common_tags({"market": "vancouver", "skip_me": None})
    assert tags["repo"] == "canadian-investor-dashboard"
    assert tags["market"] == "vancouver"
    assert "skip_me" not in tags
    assert "sklearn_version" in tags


def _register(name: str, *, architecture: str, spatial: float, mape: float) -> str:
    mt.configure(mt.EXPERIMENT_PROD)
    with mt.start_run(run_name=f"seed-{architecture}") as run:
        run_id = run.info.run_id
    return mt.register_model(
        run_id,
        name=name,
        source=f"/tmp/{name}-{architecture}.pkl",
        tags={
            "architecture": architecture,
            "model_version": f"{name}-x",
            "bundle_sha256": "deadbeef",
            "spatial_cv_mae": spatial,
            "holdout_mape": mape,
        },
    )


def test_register_and_transition_round_trip() -> None:
    name = "unit-test-model-a"
    version = _register(name, architecture="local-per-type", spatial=100_000.0, mape=0.10)
    mt.transition_stage(name, version, "Production")
    production = mt.client().get_latest_versions(name, stages=["Production"])
    assert len(production) == 1
    assert production[0].version == version
    assert production[0].tags["architecture"] == "local-per-type"


def test_promotion_picks_lower_spatial_cv() -> None:
    import promote_models as promote

    name = "unit-test-model-b"
    _register(name, architecture="local-per-type", spatial=200_000.0, mape=0.12)
    pooled = _register(name, architecture="pooled-features", spatial=150_000.0, mape=0.13)
    best = promote.promote(name, mt.client(), dry_run=False)
    assert best["version"] == pooled
    assert mt.client().get_latest_versions(name, stages=["Production"])[0].version == pooled


def test_promotion_guardrail_blocks_mape_regression() -> None:
    import promote_models as promote

    name = "unit-test-model-c"
    incumbent = _register(name, architecture="local-per-type", spatial=200_000.0, mape=0.12)
    mt.transition_stage(name, incumbent, "Production")
    # Much lower spatial CV but a large MAPE regression (+0.08 > 0.02 tolerance) -> blocked.
    _register(name, architecture="pooled-features", spatial=100_000.0, mape=0.20)
    kept = promote.promote(name, mt.client(), dry_run=False)
    assert kept["version"] == incumbent
    assert mt.client().get_latest_versions(name, stages=["Production"])[0].version == incumbent


@pytest.fixture(scope="module")
def lab_payload(tmp_path_factory: pytest.TempPathFactory):
    pytest.importorskip("duckdb")
    pytest.importorskip("sklearn")
    tmp_path = tmp_path_factory.mktemp("mlflow_lab")
    vancouver_path = tmp_path / "vancouver_training.csv"
    halifax_path = tmp_path / "halifax_training.csv"
    _replicated(_small_vancouver_training_frame(), 60).to_csv(vancouver_path, index=False)
    _replicated(_small_halifax_training_frame(), 60).to_csv(halifax_path, index=False)
    warehouse_path = tmp_path / "property_analytics.duckdb"
    build_property_warehouse(
        vancouver_training_path=vancouver_path,
        halifax_training_path=halifax_path,
        halifax_permits_path=tmp_path / "missing_permits.csv",
        warehouse_path=warehouse_path,
        report_path=tmp_path / "analytics_warehouse_report.md",
    )
    payload = run_model_experiments(
        warehouse_path=warehouse_path,
        export_path=tmp_path / "model_experiments.json",
        report_path=tmp_path / "model_experiments_report.md",
    )
    return payload


def test_lab_logs_parent_and_nested_children(lab_payload) -> None:
    mt.configure(mt.EXPERIMENT_LAB)
    client = mt.client()
    experiment = client.get_experiment_by_name(mt.EXPERIMENT_LAB)
    runs = client.search_runs([experiment.experiment_id])
    children = [run for run in runs if run.data.tags.get("mlflow.parentRunId")]
    parents = [run for run in runs if not run.data.tags.get("mlflow.parentRunId")]
    # One nested child per architecture x market for the latest run.
    expected_children = len(EXPERIMENTS) * 2
    assert len(parents) >= 1
    assert len(children) >= expected_children
    architectures = {run.data.params.get("architecture") for run in children}
    assert architectures == set(EXPERIMENTS)
    # Exactly one winner per market in the most recent batch.
    winners = [run for run in children if run.data.tags.get("is_market_winner") == "true"]
    assert len(winners) >= 2
    for run in children:
        assert "holdout_mae" in run.data.metrics


def test_lab_export_keeps_original_five_keys(lab_payload) -> None:
    # MLflow logging must not perturb the lab's committed JSON contract.
    assert set(lab_payload.keys()) == {"status", "generatedAt", "source", "rows", "conclusions"}
