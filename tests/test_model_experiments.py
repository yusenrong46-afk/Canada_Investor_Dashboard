import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from scripts.build_property_warehouse import build_property_warehouse
from scripts.run_model_experiments import EXPERIMENTS, run_model_experiments
from tests.test_property_warehouse import _small_halifax_training_frame, _small_vancouver_training_frame


REQUIRED_ROW_KEYS = {
    "experiment",
    "market",
    "propertyType",
    "family",
    "trainingRows",
    "holdoutRows",
    "holdoutMae",
    "holdoutMape",
    "spatialCvMae",
}


def _replicated(base: pd.DataFrame, copies: int) -> pd.DataFrame:
    """Replicate the tiny warehouse fixtures with deterministic jitter so the
    splits are stable and holdout errors are non-zero."""
    frames = []
    for index in range(copies):
        frame = base.copy()
        frame["price"] = (frame["price"] * (1.0 + 0.004 * (index % 23))).round(0)
        frame["livingAreaSqft"] = frame["livingAreaSqft"] + (index % 11) * 6
        frame["logPrice"] = np.log1p(frame["price"])
        frame["pricePerSqft"] = (frame["price"] / frame["livingAreaSqft"]).round(2)
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)


@pytest.fixture(scope="module")
def experiment_lab(tmp_path_factory: pytest.TempPathFactory):
    pytest.importorskip("duckdb")
    pytest.importorskip("sklearn")

    tmp_path = tmp_path_factory.mktemp("experiment_lab")
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

    export_path = tmp_path / "model_experiments.json"
    report_path = tmp_path / "model_experiments_report.md"
    payload = run_model_experiments(
        warehouse_path=warehouse_path,
        export_path=export_path,
        report_path=report_path,
    )
    return payload, warehouse_path, export_path, report_path


def test_all_experiments_present_for_both_markets(experiment_lab):
    payload, _, _, _ = experiment_lab
    market_level = {(row["experiment"], row["market"]) for row in payload["rows"] if row["propertyType"] == "All"}
    assert market_level == {
        (experiment, market)
        for experiment in EXPERIMENTS
        for market in ("vancouver", "halifax_maritimes")
    }


def test_metrics_are_finite_and_positive(experiment_lab):
    payload, _, _, _ = experiment_lab
    assert payload["rows"]
    for row in payload["rows"]:
        assert math.isfinite(row["holdoutMae"]) and row["holdoutMae"] > 0
        assert math.isfinite(row["holdoutMape"]) and row["holdoutMape"] > 0
        assert row["trainingRows"] > 0
        assert row["holdoutRows"] > 0
        if row["spatialCvMae"] is not None:
            assert math.isfinite(row["spatialCvMae"]) and row["spatialCvMae"] > 0


def test_export_matches_response_contract(experiment_lab):
    _, _, export_path, _ = experiment_lab
    exported = json.loads(export_path.read_text())
    assert set(exported.keys()) == {"status", "generatedAt", "source", "rows", "conclusions"}
    assert exported["status"] == "ready"
    assert isinstance(exported["source"], str) and exported["source"]
    for row in exported["rows"]:
        assert REQUIRED_ROW_KEYS.issubset(row.keys())
        assert set(row.keys()) <= REQUIRED_ROW_KEYS | {"notes"}
        assert row["experiment"] in EXPERIMENTS
        if row.get("notes") is not None:
            assert isinstance(row["notes"], str)


def test_conclusions_are_non_empty_and_state_target_caveat(experiment_lab):
    payload, _, _, _ = experiment_lab
    conclusions = payload["conclusions"]
    assert conclusions and all(isinstance(conclusion, str) and conclusion for conclusion in conclusions)
    assert any("listing price" in conclusion and "sale price" in conclusion for conclusion in conclusions)


def test_thin_property_type_slices_are_skipped_not_fabricated(experiment_lab):
    payload, _, _, _ = experiment_lab
    # Every property-type slice in the synthetic mart has < 30 holdout rows,
    # so only market-level rows may appear.
    assert all(row["propertyType"] == "All" for row in payload["rows"])
    assert any("Skipped thin property-type slices" in (row.get("notes") or "") for row in payload["rows"])
    assert any("too thin" in conclusion for conclusion in payload["conclusions"])


def test_experiments_table_written_to_warehouse(experiment_lab):
    duckdb = pytest.importorskip("duckdb")
    payload, warehouse_path, _, report_path = experiment_lab

    connection = duckdb.connect(str(warehouse_path), read_only=True)
    try:
        table_rows = connection.execute("SELECT COUNT(*) FROM fact_model_experiments").fetchone()[0]
        columns = {
            column[0] for column in connection.execute("DESCRIBE fact_model_experiments").fetchall()
        }
    finally:
        connection.close()

    assert table_rows == len(payload["rows"])
    assert {"experiment", "market", "property_type", "family", "holdout_mae", "spatial_cv_mae", "run_at"} <= columns

    report = report_path.read_text()
    assert report.startswith("# Model Experiment Lab Report")
    assert "## Market Leaderboards" in report
    assert "## Conclusions" in report
