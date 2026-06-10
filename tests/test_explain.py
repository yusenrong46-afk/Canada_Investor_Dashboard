from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

MODEL_SERVICE_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from common.explain import shap_drivers  # noqa: E402

NUMERIC_FEATURES = ["livingAreaSqft", "bedrooms", "bathrooms", "ageYears"]
CATEGORICAL_FEATURES = ["postalFsa", "submarketCluster"]


def _synthetic_listing_frame(rows: int = 300) -> tuple[pd.DataFrame, np.ndarray]:
    rng = np.random.default_rng(42)
    frame = pd.DataFrame(
        {
            "livingAreaSqft": rng.uniform(500, 3500, rows),
            "bedrooms": rng.integers(1, 6, rows).astype(float),
            "bathrooms": rng.integers(1, 4, rows).astype(float),
            "ageYears": rng.uniform(0, 60, rows),
            "postalFsa": rng.choice(["V5K", "V6B"], rows),
            "submarketCluster": rng.choice(["3", "7"], rows),
        },
    )
    price = (
        (60_000 + 950 * frame["livingAreaSqft"] + 25_000 * frame["bedrooms"] + 15_000 * frame["bathrooms"] - 800 * frame["ageYears"])
        * np.where(frame["postalFsa"] == "V6B", 1.35, 1.0)
        * np.where(frame["submarketCluster"] == "3", 1.05, 1.0)
        + rng.normal(0, 20_000, rows)
    )
    return frame, np.log(price.to_numpy(dtype=float))


def _build_pipeline(regressor) -> Pipeline:
    # Mirrors _build_preprocessor / _build_candidate_pipelines in base_model/core.py.
    numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    categorical_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ],
    )
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_pipeline, NUMERIC_FEATURES),
            ("cat", categorical_pipeline, CATEGORICAL_FEATURES),
        ],
        remainder="drop",
    )
    return Pipeline([("prep", preprocessor), ("model", regressor)])


def _fitted_tree_pipeline() -> tuple[Pipeline, pd.DataFrame]:
    pytest.importorskip("shap")
    frame, log_price = _synthetic_listing_frame()
    pipeline = _build_pipeline(RandomForestRegressor(n_estimators=80, min_samples_leaf=2, random_state=42, n_jobs=2))
    pipeline.fit(frame, log_price)
    return pipeline, frame


def _query_row() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "livingAreaSqft": 3400.0,
                "bedrooms": 4.0,
                "bathrooms": 3.0,
                "ageYears": 5.0,
                "postalFsa": "V6B",
                "submarketCluster": "3",
            },
        ],
    )


def test_shap_drivers_returns_shap_method_with_required_keys() -> None:
    pipeline, _ = _fitted_tree_pipeline()
    row = _query_row()
    base_value = float(np.exp(pipeline.predict(row)[0]))

    drivers, method = shap_drivers(pipeline, row, base_value)

    assert method == "shap"
    assert isinstance(drivers, list)
    assert drivers
    assert len(drivers) <= 6
    for driver in drivers:
        assert set(driver.keys()) == {"label", "value", "source"}
        assert driver["source"] == "shap"
        assert isinstance(driver["value"], int)
        assert abs(driver["value"]) >= 5_000


def test_shap_drivers_rank_living_area_first_for_large_home() -> None:
    pipeline, _ = _fitted_tree_pipeline()
    row = _query_row()
    base_value = float(np.exp(pipeline.predict(row)[0]))

    drivers, method = shap_drivers(pipeline, row, base_value)

    assert method == "shap"
    labels = [driver["label"] for driver in drivers]
    assert "Living area" in labels
    assert drivers[0]["label"] == "Living area"
    magnitudes = [abs(driver["value"]) for driver in drivers]
    assert magnitudes == sorted(magnitudes, reverse=True)


def test_shap_drivers_collapse_one_hot_columns_per_source_feature() -> None:
    pipeline, _ = _fitted_tree_pipeline()
    row = _query_row()
    base_value = float(np.exp(pipeline.predict(row)[0]))

    drivers, method = shap_drivers(pipeline, row, base_value)

    assert method == "shap"
    postal_labels = [driver["label"] for driver in drivers if driver["label"].startswith("Postal area")]
    cluster_labels = [driver["label"] for driver in drivers if driver["label"].startswith("Submarket cluster")]
    assert len(postal_labels) <= 1
    assert len(cluster_labels) <= 1
    if postal_labels:
        assert postal_labels == ["Postal area V6B"]
    if cluster_labels:
        assert cluster_labels == ["Submarket cluster 3"]
    labels = [driver["label"] for driver in drivers]
    assert len(labels) == len(set(labels))


def test_shap_drivers_degrade_to_heuristic_for_non_tree_regressor() -> None:
    pytest.importorskip("shap")
    frame, log_price = _synthetic_listing_frame()
    pipeline = _build_pipeline(LinearRegression())
    pipeline.fit(frame, log_price)
    row = _query_row()
    base_value = float(np.exp(pipeline.predict(row)[0]))

    drivers, method = shap_drivers(pipeline, row, base_value)

    assert drivers is None
    assert method == "heuristic"
