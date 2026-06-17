"""Shared pytest fixtures.

Critically: redirect MLflow at the whole test session to a throwaway SQLite store so no
test (including the experiment-lab and production-training tests, which log runs) ever
writes to the committed `mlflow/tracking.db`. Also clear the opt-in training-logging /
registry env flags so default test runs exercise the offline code paths.
"""

from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def _isolate_mlflow_store(tmp_path_factory: pytest.TempPathFactory) -> None:
    store = tmp_path_factory.mktemp("mlflow_store")
    os.environ["MLFLOW_TRACKING_URI"] = f"sqlite:///{store / 'tracking.db'}"
    os.environ["MLFLOW_ARTIFACT_LOCATION"] = f"file://{store / 'artifacts'}"
    # Default to the offline paths; individual tests opt in explicitly.
    os.environ.pop("MLFLOW_LOG_TRAINING", None)
    os.environ.pop("MODEL_REGISTRY_ENABLED", None)
    os.environ.pop("MLFLOW_LOG_BUNDLE_ARTIFACT", None)
