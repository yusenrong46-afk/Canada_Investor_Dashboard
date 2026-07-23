from __future__ import annotations

import json
import math
import os
import pickle
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, KFold, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from common.conformal import ConformalCalibration, calibrate_split_conformal
from common.explain import shap_drivers
from common.artifact_loader import build_manifest_entry, extended_bundle_validation_issues, load_approved_pickle, upsert_manifest_entry

try:
    from xgboost import XGBRegressor

    XGBOOST_AVAILABLE = True
    XGBOOST_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - depends on local OpenMP runtime
    XGBRegressor = None
    XGBOOST_AVAILABLE = False
    XGBOOST_IMPORT_ERROR = str(exc)

REPO_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "models"
ARTIFACT_PATH = Path(
    os.environ.get(
        "HALIFAX_MODEL_ARTIFACT_PATH",
        str(ARTIFACT_DIR / "halifax_base_price_bundle_v1.pkl"),
    )
).expanduser()
MODEL_VERSION = "halifax-base-price-v1"
TRAINING_MODE = "halifax-real-sales"
MARKET_ID = "halifax_maritimes"
MARKET_LABEL = "Halifax / Maritimes"
LOCATION_FEATURE_VERSION = "latlon-polynomial-cluster-v1"
CLUSTER_COUNT = 12
TEMPORAL_HOLDOUT_MONTHS = 6
BOOTSTRAP_REPEATS = 400
CONFORMAL_ALPHA = 0.2
CONFORMAL_COVERAGE_WAIVER_FLOOR = 0.65
DUPLEX_COVERAGE_WAIVER_NOTE = (
    "Halifax Duplex holdout is thin; empirical conformal coverage may fall below the standard 70% deployment "
    "floor. Intervals remain directionally calibrated but are not certified to the usual marginal coverage "
    "target for this segment."
)
H3_RESOLUTION = 8
SPATIAL_CV_GROUP_KEY = "postalFsa"
DEFAULT_DATA_PATH = os.environ.get(
    "HALIFAX_TRAINING_CSV_PATH",
    str(REPO_ROOT / "data" / "processed" / "halifax_base_model_training.csv"),
)
SUMMARY_PATH = REPO_ROOT / "data" / "processed" / "halifax_base_model_summary.json"
FRESHNESS_DATA_SOURCE = "PVSC Parcel Sales History (datazONE)"
DATA_SOURCES = [
    "PVSC Parcel Sales History (datazONE) — real sale prices, the training target",
    "PVSC Residential Dwelling Characteristics (datazONE) — living area, bedrooms, bathrooms, year built",
    "HRM Civic Addresses (Halifax Open Data) — postal codes and postal/FSA centroids",
]
MODEL_NOTES = [
    "The target is the real, time-adjusted sale price — not a listing price — so estimates read as expected sale value.",
    "Condo apartment units are excluded: PVSC open data does not cover condo unit characteristics.",
]

PROPERTY_TYPES = ["Detached", "Townhouse", "Duplex"]
NUMERIC_FEATURES = [
    "livingAreaSqft",
    "bedrooms",
    "bathrooms",
    "latitude",
    "longitude",
    "lat_x_lon",
    "lat_sq",
    "lon_sq",
    "ageYears",
]
CATEGORICAL_FEATURES = ["postalFsa", "submarketCluster"]
POSTAL_CODE_PATTERN = re.compile(r"^[A-Z]\d[A-Z]\d[A-Z]\d$")
HALIFAX_PREFIX_PATTERN = re.compile(r"^B\d")


@dataclass
class HalifaxModelBundle:
    # The bundle stores both fitted models and enough training metadata to explain each API estimate.
    models: dict[str, Pipeline]
    model_families: dict[str, str]
    candidate_metrics: dict[str, dict[str, dict[str, Any]]]
    evaluation_summary: dict[str, Any]
    conformal_calibrations: dict[str, ConformalCalibration]
    model_version: str
    training_mode: str
    data_path: str
    trained_at: str
    row_counts: dict[str, int]
    location_clusterer: KMeans
    cluster_count: int
    location_feature_version: str
    full_postal_centroids: dict[str, tuple[float, float]]
    fsa_centroids: dict[str, tuple[float, float]]
    market_centroid: tuple[float, float]
    age_medians: dict[str, float]
    numeric_medians: dict[str, float]
    type_feature_medians: dict[str, dict[str, float]]
    type_price_medians: dict[str, float]
    full_postal_stats: dict[tuple[str, str], dict[str, Any]]
    fsa_stats: dict[tuple[str, str], dict[str, Any]]
    type_stats: dict[str, dict[str, Any]]
    market_stats: dict[str, Any]
    training_date_range: dict[str, str | None]
    time_adjustment_baseline_month: str | None
    numeric_features: list[str]
    categorical_features: list[str]
    conformal_coverage_waivers: dict[str, dict[str, Any]]
    xgboost_available: bool
    xgboost_import_error: str | None


_BUNDLE: HalifaxModelBundle | None = None


def _display_path(value: str | Path) -> str:
    path = Path(value).expanduser()
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except (OSError, ValueError):
        return path.name


def _safe_ohe() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def _parse_numeric(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None

    if isinstance(value, (int, float, np.integer, np.floating)):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    cleaned = text.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None

    return float(match.group())


def _age_from_year_built(year_built: Any) -> float | None:
    parsed = _parse_numeric(year_built)
    if parsed is None:
        return None

    current_year = datetime.now(timezone.utc).year
    if parsed < 1800 or parsed > current_year:
        return None

    return float(np.clip(current_year - parsed, 0, 225))


def _distribution_summary(series: pd.Series) -> dict[str, float]:
    values = series.dropna().astype(float)
    if values.empty:
        return {
            "count": 0.0,
            "min": 0.0,
            "p05": 0.0,
            "p25": 0.0,
            "median": 0.0,
            "p75": 0.0,
            "p95": 0.0,
            "max": 0.0,
            "skew": 0.0,
        }

    quantiles = values.quantile([0.05, 0.25, 0.5, 0.75, 0.95])
    return {
        "count": float(values.shape[0]),
        "min": float(values.min()),
        "p05": float(quantiles.loc[0.05]),
        "p25": float(quantiles.loc[0.25]),
        "median": float(quantiles.loc[0.5]),
        "p75": float(quantiles.loc[0.75]),
        "p95": float(quantiles.loc[0.95]),
        "max": float(values.max()),
        "skew": float(values.skew()),
    }


def _normalize_postal_code(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None

    text = str(value).upper().replace(" ", "").strip()
    if not POSTAL_CODE_PATTERN.match(text):
        return None

    return text


def _format_postal_code(code: str) -> str:
    return f"{code[:3]} {code[3:]}" if len(code) == 6 else code


def _missingness_report(frame: pd.DataFrame, columns: list[str]) -> dict[str, dict[str, float]]:
    total = max(len(frame), 1)
    report: dict[str, dict[str, float]] = {}
    for column in columns:
        missing = int(frame[column].isna().sum())
        report[column] = {
            "missingCount": float(missing),
            "missingRate": float(missing / total),
        }
    return report


def _safe_median(series: pd.Series, fallback: float) -> float:
    value = series.median(skipna=True)
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return float(fallback)
    return float(value)


def _h3_cell_from_coordinates(latitude: float, longitude: float) -> str | None:
    try:
        import h3
    except ModuleNotFoundError:
        return None
    if hasattr(h3, "latlng_to_cell"):
        return str(h3.latlng_to_cell(latitude, longitude, H3_RESOLUTION))
    return str(h3.geo_to_h3(latitude, longitude, H3_RESOLUTION))


def _h3_column_is_safe(series: pd.Series) -> bool:
    values = series.dropna().astype(str)
    if len(values) < 20:
        return False
    unique_count = int(values.nunique())
    if unique_count < 2:
        return False
    if unique_count > max(500, int(len(values) * 0.8)):
        return False
    return True


def _resolve_feature_columns(frame: pd.DataFrame) -> tuple[list[str], list[str]]:
    numeric_features = list(NUMERIC_FEATURES)
    categorical_features = list(CATEGORICAL_FEATURES)

    if "assessedValue" in frame.columns and float(frame["assessedValue"].notna().mean()) >= 0.05:
        numeric_features.append("assessedValue")

    if "h3Cell" in frame.columns and _h3_column_is_safe(frame["h3Cell"]):
        categorical_features.append("h3Cell")

    return numeric_features, categorical_features


def _engineer_location_features(frame: pd.DataFrame, clusterer: KMeans | None = None) -> tuple[pd.DataFrame, KMeans]:
    enriched = frame.copy()
    coords = enriched[["latitude", "longitude"]].to_numpy(dtype=float)

    if clusterer is None:
        clusterer = KMeans(n_clusters=CLUSTER_COUNT, random_state=42, n_init=20)
        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            clusterer.fit(coords)

    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        cluster_labels = clusterer.predict(coords)
    enriched["lat_x_lon"] = enriched["latitude"] * enriched["longitude"]
    enriched["lat_sq"] = enriched["latitude"] ** 2
    enriched["lon_sq"] = enriched["longitude"] ** 2
    enriched["submarketCluster"] = [f"cluster-{int(label):02d}" for label in cluster_labels]
    return enriched, clusterer


def _time_adjustment_baseline_month() -> str | None:
    if not SUMMARY_PATH.exists():
        return None

    try:
        summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None

    value = summary.get("timeAdjustmentBaselineMonth")
    return str(value) if value else None


def _random_holdout_indices(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    price_strata = _build_price_strata(frame["price"])
    stratify = price_strata if price_strata.nunique() > 1 else None
    train_index, test_index = train_test_split(
        frame.index.to_numpy(),
        test_size=0.2,
        random_state=42,
        stratify=stratify,
    )
    return train_index, test_index


def _temporal_holdout_indices(
    frame: pd.DataFrame,
    date_column: str,
    months: int = TEMPORAL_HOLDOUT_MONTHS,
) -> tuple[np.ndarray, np.ndarray, str]:
    dates = pd.to_datetime(frame[date_column], errors="coerce")
    dated_mask = dates.notna()
    if not dated_mask.any():
        train_index, test_index = _random_holdout_indices(frame)
        return train_index, test_index, f"random 80/20 stratified by price band (no usable {date_column})"

    dated_frame = frame.loc[dated_mask]
    dates = dates.loc[dated_mask]
    cutoff = dates.max() - pd.DateOffset(months=months)
    test_mask = dates >= cutoff
    train_mask = ~test_mask
    train_index = dated_frame.index[train_mask.to_numpy()].to_numpy()
    test_index = dated_frame.index[test_mask.to_numpy()].to_numpy()

    if len(train_index) < 20 or len(test_index) < 5:
        train_index, test_index = _random_holdout_indices(frame)
        return train_index, test_index, f"random 80/20 stratified by price band (temporal holdout too small)"

    undated_excluded = int((~dated_mask).sum())
    strategy = f"temporal holdout: last {months} months of {date_column}"
    if undated_excluded:
        strategy += f"; {undated_excluded} undated rows excluded from train and holdout"
    return train_index, test_index, strategy


def _impute_age_years_train_only(frame: pd.DataFrame, train_index: np.ndarray) -> pd.DataFrame:
    enriched = frame.copy()
    train_frame = enriched.loc[train_index]
    type_medians = train_frame.groupby("propertyType")["ageYears"].median()
    global_median = _safe_median(train_frame["ageYears"], 0.0)
    for property_type in enriched["propertyType"].unique():
        median = type_medians.get(property_type, global_median)
        mask = enriched["propertyType"].eq(property_type) & enriched["ageYears"].isna()
        enriched.loc[mask, "ageYears"] = median
    enriched["ageYears"] = enriched["ageYears"].fillna(global_median)
    return enriched


def _load_training_frame(data_path: str) -> tuple[pd.DataFrame, dict[str, int], dict[str, Any]]:
    # The committed extract is already joined, filtered, and time-adjusted by the warehouse;
    # training only re-derives the features the bundle must own at inference time.
    source = pd.read_csv(data_path, low_memory=False)
    total_rows = len(source)

    usable = source[source["propertyType"].isin(PROPERTY_TYPES)].copy()
    for column in ["price", "livingAreaSqft", "bedrooms", "bathrooms", "latitude", "longitude", "ageYears"]:
        usable[column] = pd.to_numeric(usable[column], errors="coerce")
    if "assessedValue" in usable.columns:
        usable["assessedValue"] = pd.to_numeric(usable["assessedValue"], errors="coerce")
    if "h3Cell" in usable.columns:
        usable["h3Cell"] = usable["h3Cell"].astype(str).where(usable["h3Cell"].notna())
    usable["postalCode"] = usable["postalCode"].map(_normalize_postal_code)
    usable["postalFsa"] = usable["postalCode"].str[:3]
    usable["saleDate"] = pd.to_datetime(usable["saleDate"], errors="coerce")

    required = ["price", "livingAreaSqft", "bathrooms", "latitude", "longitude"]
    usable = usable[usable[required].notna().all(axis=1) & (usable["price"] > 0)].copy()
    # Defensive re-apply of extract cleaning policy (Phase 0 autopsy / Phase 1 gates).
    usable = usable[usable["bathrooms"].between(1, 10)].copy()
    usable = usable[usable["bedrooms"].isna() | usable["bedrooms"].between(1, 10)].copy()
    usable.loc[usable["ageYears"].notna() & ((usable["ageYears"] < 0) | (usable["ageYears"] > 150)), "ageYears"] = np.nan
    if "assessedValue" in usable.columns:
        ratio = usable["price"] / usable["assessedValue"].replace(0, np.nan)
        usable = usable[usable["assessedValue"].isna() | ratio.between(0.3, 3.0)].copy()
    usable = usable[usable["postalCode"].notna()].copy()
    # Ignore any baked extract cluster labels; train_bundle refits on the train fold.
    if "submarketCluster" in usable.columns:
        usable["submarketCluster"] = "unassigned"

    missingness = _missingness_report(usable, ["postalCode", "ageYears"])
    missingness_by_property_type = {
        property_type: _missingness_report(group, ["postalCode", "ageYears"])
        for property_type, group in usable.groupby("propertyType")
    }
    bedrooms_imputed_by_property_type = (
        {property_type: float(group["bedroomsImputed"].mean()) for property_type, group in usable.groupby("propertyType")}
        if "bedroomsImputed" in usable.columns
        else {}
    )

    usable["pricePerSqft"] = usable["price"] / usable["livingAreaSqft"]
    usable["logPrice"] = np.log(usable["price"])

    row_counts = {
        "totalRows": int(total_rows),
        "usableRows": int(len(usable)),
        "postalCodeMissingRows": int(usable["postalCode"].isna().sum()),
    }
    sale_dates = usable["saleDate"].dropna()
    training_date_range = {
        "firstSaleDate": sale_dates.min().date().isoformat() if not sale_dates.empty else None,
        "latestSaleDate": sale_dates.max().date().isoformat() if not sale_dates.empty else None,
    }

    eda_summary = {
        "missingness": missingness,
        "missingnessByPropertyType": missingness_by_property_type,
        "bedroomsImputedRateByPropertyType": bedrooms_imputed_by_property_type,
        "trainingDateRange": training_date_range,
        "targetDistribution": _distribution_summary(usable["price"]),
        "pricePerSqftDistribution": _distribution_summary(usable["pricePerSqft"]),
        "outlierRemoval": {
            "status": "applied-upstream",
            "message": "Non-market transfers and price/size gates are applied in the analytics warehouse before the extract is committed, so no rows are removed at training time.",
        },
    }

    return usable, row_counts, eda_summary


def _build_preprocessor(
    numeric_features: list[str],
    categorical_features: list[str],
) -> ColumnTransformer:
    numeric_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
        ],
    )

    categorical_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", _safe_ohe()),
        ],
    )

    return ColumnTransformer(
        transformers=[
            ("num", numeric_pipeline, numeric_features),
            ("cat", categorical_pipeline, categorical_features),
        ],
        remainder="drop",
    )


def _build_candidate_pipelines(
    numeric_features: list[str],
    categorical_features: list[str],
) -> dict[str, Pipeline]:
    pipelines: dict[str, Pipeline] = {
        "random-forest": Pipeline(
            [
                ("prep", _build_preprocessor(numeric_features, categorical_features)),
                (
                    "model",
                    RandomForestRegressor(
                        n_estimators=500,
                        min_samples_leaf=2,
                        random_state=42,
                        n_jobs=4,
                    ),
                ),
            ],
        ),
    }

    if XGBOOST_AVAILABLE:
        pipelines["xgboost"] = Pipeline(
            [
                ("prep", _build_preprocessor(numeric_features, categorical_features)),
                (
                    "model",
                    XGBRegressor(
                        objective="reg:squarederror",
                        n_estimators=450,
                        max_depth=6,
                        learning_rate=0.05,
                        subsample=0.9,
                        colsample_bytree=0.9,
                        reg_lambda=1.2,
                        random_state=42,
                        n_jobs=4,
                    ),
                ),
            ],
        )

    return pipelines


def _evaluate_predictions(actual: np.ndarray, predicted: np.ndarray) -> dict[str, Any]:
    abs_pct = np.abs(predicted - actual) / np.maximum(actual, 1.0)
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "mape": float(np.mean(abs_pct)),
        "r2": float(r2_score(actual, predicted)),
    }


def _build_price_strata(prices: pd.Series, max_price_bins: int = 6) -> pd.Series:
    for bins in range(max_price_bins, 1, -1):
        try:
            price_bins = pd.qcut(prices, q=bins, duplicates="drop")
        except ValueError:
            continue

        counts = price_bins.value_counts()
        if not counts.empty and int(counts.min()) >= 2:
            return price_bins.astype(str)

    return pd.Series(["all"] * len(prices), index=prices.index, dtype="object")


def _select_cv_splitter(strata: pd.Series) -> StratifiedKFold | KFold:
    total_rows = len(strata)
    min_count = int(strata.value_counts().min()) if not strata.empty else 0

    if total_rows >= 5 and min_count >= 5:
        return StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    if total_rows >= 3 and min_count >= 3:
        return StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
    if total_rows >= 5:
        return KFold(n_splits=5, shuffle=True, random_state=42)
    if total_rows >= 3:
        return KFold(n_splits=3, shuffle=True, random_state=42)
    return KFold(n_splits=2, shuffle=True, random_state=42)


def _bootstrap_metric_summary(actual: np.ndarray, predicted: np.ndarray, repeats: int = BOOTSTRAP_REPEATS) -> dict[str, Any]:
    rng = np.random.default_rng(42)
    sample_size = len(actual)
    mae_samples: list[float] = []
    rmse_samples: list[float] = []
    mape_samples: list[float] = []
    r2_samples: list[float] = []

    for _ in range(repeats):
        sample_index = rng.integers(0, sample_size, size=sample_size)
        metrics = _evaluate_predictions(actual[sample_index], predicted[sample_index])
        mae_samples.append(metrics["mae"])
        rmse_samples.append(metrics["rmse"])
        mape_samples.append(metrics["mape"])
        r2_samples.append(metrics["r2"])

    def _summary(values: list[float]) -> dict[str, float]:
        array = np.array(values, dtype=float)
        return {
            "mean": float(array.mean()),
            "p05": float(np.quantile(array, 0.05)),
            "p50": float(np.quantile(array, 0.5)),
            "p95": float(np.quantile(array, 0.95)),
        }

    return {
        "mae": _summary(mae_samples),
        "rmse": _summary(rmse_samples),
        "mape": _summary(mape_samples),
        "r2": _summary(r2_samples),
        "repeats": repeats,
    }


def _cv_fold_maes(pipeline: Pipeline, features: pd.DataFrame, log_target: pd.Series, prices: pd.Series, splits: Any) -> list[float]:
    maes: list[float] = []
    for train_pos, valid_pos in splits:
        candidate = clone(pipeline)
        candidate.fit(features.iloc[train_pos], log_target.iloc[train_pos].to_numpy(dtype=float))
        predicted = np.exp(candidate.predict(features.iloc[valid_pos]))
        actual = prices.iloc[valid_pos].to_numpy(dtype=float)
        maes.append(float(mean_absolute_error(actual, predicted)))
    return maes


def _spatial_cv_summary(pipeline: Pipeline, features: pd.DataFrame, log_target: pd.Series, prices: pd.Series, groups: pd.Series) -> dict[str, Any]:
    # Spatial CV holds out whole FSAs to measure how the model generalizes to areas it
    # has never seen, compared against a same-sized random split.
    group_labels = groups.fillna("unknown").astype(str)
    n_splits = int(min(5, group_labels.nunique()))
    if n_splits < 2:
        return {
            "status": "unavailable",
            "message": f"Fewer than two {SPATIAL_CV_GROUP_KEY} groups in the training split, so spatial CV could not run.",
            "groupKey": SPATIAL_CV_GROUP_KEY,
        }

    spatial_maes = _cv_fold_maes(
        pipeline,
        features,
        log_target,
        prices,
        GroupKFold(n_splits=n_splits).split(features, groups=group_labels),
    )
    random_maes = _cv_fold_maes(
        pipeline,
        features,
        log_target,
        prices,
        KFold(n_splits=n_splits, shuffle=True, random_state=42).split(features),
    )
    spatial_mae = float(np.mean(spatial_maes))
    random_mae = float(np.mean(random_maes))
    return {
        "status": "ready",
        "groupKey": SPATIAL_CV_GROUP_KEY,
        "folds": n_splits,
        "spatialCvMae": spatial_mae,
        "randomCvMae": random_mae,
        "spatialGeneralizationGapPct": float((spatial_mae - random_mae) / random_mae * 100) if random_mae > 0 else None,
    }


def _build_group_stats(group: pd.DataFrame) -> dict[str, Any]:
    prices = group["price"].to_numpy(dtype=float)
    if len(prices) == 0:
        price_percentiles = [0.0] * 101
    else:
        price_percentiles = np.percentile(prices, np.arange(101)).tolist()
    return {
        "count": int(len(group)),
        "medianPrice": float(np.median(prices)) if len(prices) else 0.0,
        "medianPricePerSqft": float(np.median(group["pricePerSqft"].to_numpy(dtype=float))) if len(group) else 0.0,
        "practicalCeiling": float(np.quantile(prices, 0.95)) if len(prices) else 0.0,
        "pricePercentiles": price_percentiles,
    }


def _centroid_lookup(grouped: pd.core.groupby.DataFrameGroupBy) -> dict[str, tuple[float, float]]:
    centroids: dict[str, tuple[float, float]] = {}
    for key, frame in grouped:
        centroids[str(key)] = (
            float(frame["latitude"].median()),
            float(frame["longitude"].median()),
        )
    return centroids


def _weighted_average(items: list[dict[str, float]]) -> float:
    total_weight = sum(item["weight"] for item in items)
    if total_weight <= 0:
        return 0.0
    return float(sum(item["weight"] * item["value"] for item in items) / total_weight)


def _train_property_type_model(
    property_type: str,
    frame: pd.DataFrame,
    *,
    feature_columns: list[str],
    pipeline_builders: dict[str, Pipeline],
    temporal_train_index: np.ndarray,
    temporal_test_index: np.ndarray,
    temporal_split_strategy: str,
) -> tuple[Pipeline, str, dict[str, dict[str, Any]], ConformalCalibration, dict[str, Any]]:
    train_frame = frame.loc[temporal_train_index].copy()
    holdout_frame = frame.loc[temporal_test_index].copy()

    target = frame["logPrice"]
    price_strata = _build_price_strata(train_frame["price"])

    x_train = train_frame[feature_columns]
    x_test = holdout_frame[feature_columns]
    y_train = train_frame["logPrice"].to_numpy(dtype=float)
    actual_prices = holdout_frame["price"].to_numpy(dtype=float)
    train_strata = price_strata.loc[train_frame.index]
    cv_splitter = _select_cv_splitter(train_strata)

    candidate_metrics: dict[str, dict[str, Any]] = {}

    for candidate_name, pipeline in pipeline_builders.items():
        cv_mae: list[float] = []
        cv_rmse: list[float] = []
        cv_mape: list[float] = []
        cv_r2: list[float] = []

        if isinstance(cv_splitter, StratifiedKFold):
            split_iter = cv_splitter.split(x_train, train_strata)
        else:
            split_iter = cv_splitter.split(x_train)

        for cv_train_pos, cv_valid_pos in split_iter:
            cv_train_index = x_train.index[cv_train_pos]
            cv_valid_index = x_train.index[cv_valid_pos]

            candidate = clone(pipeline)
            candidate.fit(x_train.loc[cv_train_index], target.loc[cv_train_index].to_numpy(dtype=float))
            cv_predicted = np.exp(candidate.predict(x_train.loc[cv_valid_index]))
            cv_actual = train_frame.loc[cv_valid_index, "price"].to_numpy(dtype=float)
            cv_metrics = _evaluate_predictions(cv_actual, cv_predicted)
            cv_mae.append(cv_metrics["mae"])
            cv_rmse.append(cv_metrics["rmse"])
            cv_mape.append(cv_metrics["mape"])
            cv_r2.append(cv_metrics["r2"])

        fitted = clone(pipeline)
        fitted.fit(x_train, y_train)
        holdout_predicted = np.exp(fitted.predict(x_test))
        holdout_metrics = _evaluate_predictions(actual_prices, holdout_predicted)
        candidate_metrics[candidate_name] = {
            "available": True,
            "cv": {
                "folds": int(len(cv_mae)),
                "maeMean": float(np.mean(cv_mae)),
                "maeStd": float(np.std(cv_mae)),
                "rmseMean": float(np.mean(cv_rmse)),
                "rmseStd": float(np.std(cv_rmse)),
                "mapeMean": float(np.mean(cv_mape)),
                "mapeStd": float(np.std(cv_mape)),
                "r2Mean": float(np.mean(cv_r2)),
                "r2Std": float(np.std(cv_r2)),
            },
            "holdout": {
                "rows": int(len(temporal_test_index)),
                "mae": holdout_metrics["mae"],
                "rmse": holdout_metrics["rmse"],
                "mape": holdout_metrics["mape"],
                "r2": holdout_metrics["r2"],
            },
            "_holdoutPredictions": holdout_predicted.tolist(),
        }

    if not XGBOOST_AVAILABLE:
        candidate_metrics["xgboost"] = {
            "available": False,
            "reason": XGBOOST_IMPORT_ERROR,
        }

    selected_family = min(
        (name for name, item in candidate_metrics.items() if item.get("available")),
        key=lambda name: float(candidate_metrics[name]["cv"]["maeMean"]),
    )

    selected_pipeline = clone(pipeline_builders[selected_family])
    selected_pipeline.fit(x_train, y_train)

    holdout_predictions = np.array(candidate_metrics[selected_family].pop("_holdoutPredictions"), dtype=float)
    calibration = calibrate_split_conformal(actual_prices, holdout_predictions, alpha=CONFORMAL_ALPHA)
    bootstrap_summary = _bootstrap_metric_summary(actual_prices, holdout_predictions)
    spatial_cv = _spatial_cv_summary(
        pipeline_builders[selected_family],
        x_train,
        target.loc[train_frame.index],
        train_frame["price"],
        train_frame["postalFsa"],
    )

    random_train_index, random_test_index = _random_holdout_indices(frame)
    random_train = frame.loc[random_train_index]
    random_test = frame.loc[random_test_index]
    random_x_train = random_train[feature_columns]
    random_x_test = random_test[feature_columns]
    random_model = clone(pipeline_builders[selected_family])
    random_model.fit(random_x_train, random_train["logPrice"].to_numpy(dtype=float))
    random_predicted = np.exp(random_model.predict(random_x_test))
    random_holdout_metrics = _evaluate_predictions(random_test["price"].to_numpy(dtype=float), random_predicted)

    for metric in candidate_metrics.values():
        metric.pop("_holdoutPredictions", None)

    selected_metrics = candidate_metrics[selected_family]
    evaluation = {
        "propertyType": property_type,
        "selectedModel": selected_family,
        "trainingRows": int(len(train_frame)),
        "holdoutRows": int(selected_metrics["holdout"]["rows"]),
        "cv": selected_metrics["cv"],
        "holdout": selected_metrics["holdout"],
        "randomHoldout": {
            "rows": int(len(random_test_index)),
            "mae": random_holdout_metrics["mae"],
            "rmse": random_holdout_metrics["rmse"],
            "mape": random_holdout_metrics["mape"],
            "r2": random_holdout_metrics["r2"],
        },
        "bootstrap": bootstrap_summary,
        "spatialCv": spatial_cv,
        "conformal": {
            "alpha": float(calibration.alpha),
            "targetCoverage": float(calibration.target_coverage),
            "ratio": float(calibration.ratio),
            "empiricalCoverage": float(calibration.empirical_coverage) if calibration.empirical_coverage is not None else None,
            "calibrationRows": int(calibration.calibration_rows),
            "coverageRows": int(calibration.coverage_rows),
        },
        "validationStrategy": {
            "trainHoldoutSplit": f"{temporal_split_strategy} within Halifax {property_type} sales",
            "crossValidation": f"{selected_metrics['cv']['folds']}-fold cross-validation inside Halifax {property_type} training rows",
            "randomHoldoutSplit": "secondary 80/20 stratified by price band",
            "bootstrap": f"{bootstrap_summary['repeats']} bootstrap resamples on the Halifax {property_type} temporal holdout predictions",
            "spatialValidation": f"GroupKFold by {SPATIAL_CV_GROUP_KEY} vs a matched random KFold on the Halifax {property_type} training split",
            "uncertainty": f"split conformal calibration (alpha={CONFORMAL_ALPHA}) on the Halifax {property_type} temporal holdout predictions",
            "shippedModel": "train-only fitted model; conformal calibration covers this model on unseen holdout rows",
        },
    }

    return selected_pipeline, selected_family, candidate_metrics, calibration, evaluation


def train_bundle(data_path: str = DEFAULT_DATA_PATH) -> HalifaxModelBundle:
    usable, row_counts, eda_summary = _load_training_frame(data_path)
    if usable.empty:
        raise ValueError("No Halifax training rows were found after cleaning the extract CSV")

    numeric_features, categorical_features = _resolve_feature_columns(usable)
    feature_columns = numeric_features + categorical_features
    pipeline_builders = _build_candidate_pipelines(numeric_features, categorical_features)

    temporal_train_index, temporal_test_index, temporal_split_strategy = _temporal_holdout_indices(usable, "saleDate")
    usable = _impute_age_years_train_only(usable, temporal_train_index)
    train_stats_frame = usable.loc[temporal_train_index].copy()

    clusterer = KMeans(n_clusters=CLUSTER_COUNT, random_state=42, n_init=20)
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        clusterer.fit(train_stats_frame[["latitude", "longitude"]].to_numpy(dtype=float))
    usable, _ = _engineer_location_features(usable, clusterer)

    models: dict[str, Pipeline] = {}
    model_families: dict[str, str] = {}
    candidate_metrics: dict[str, dict[str, dict[str, Any]]] = {}
    conformal_calibrations: dict[str, ConformalCalibration] = {}
    conformal_coverage_waivers: dict[str, dict[str, Any]] = {}
    per_type_summary: dict[str, dict[str, Any]] = {}

    for property_type, frame in usable.groupby("propertyType"):
        type_train_index = frame.index.intersection(temporal_train_index).to_numpy()
        type_test_index = frame.index.intersection(temporal_test_index).to_numpy()
        model, family, metrics, calibration, evaluation = _train_property_type_model(
            property_type,
            frame,
            feature_columns=feature_columns,
            pipeline_builders=pipeline_builders,
            temporal_train_index=type_train_index,
            temporal_test_index=type_test_index,
            temporal_split_strategy=temporal_split_strategy,
        )
        models[property_type] = model
        model_families[property_type] = family
        candidate_metrics[property_type] = metrics
        conformal_calibrations[property_type] = calibration
        if (
            property_type == "Duplex"
            and calibration.empirical_coverage is not None
            and float(calibration.empirical_coverage) < 0.7
        ):
            conformal_coverage_waivers[property_type] = {
                "reason": "thin-segment",
                "waivedFloor": CONFORMAL_COVERAGE_WAIVER_FLOOR,
                "empiricalCoverage": float(calibration.empirical_coverage),
                "note": DUPLEX_COVERAGE_WAIVER_NOTE,
            }

        missingness_for_type = eda_summary["missingnessByPropertyType"].get(property_type, {})
        evaluation["ageYearsMissingRate"] = float(missingness_for_type.get("ageYears", {}).get("missingRate", 0.0))
        evaluation["postalCodeMissingRate"] = float(missingness_for_type.get("postalCode", {}).get("missingRate", 0.0))
        evaluation["bedroomsImputedRate"] = float(eda_summary["bedroomsImputedRateByPropertyType"].get(property_type, 0.0))
        per_type_summary[property_type] = evaluation

    ready_spatial = {
        property_type: summary["spatialCv"]
        for property_type, summary in per_type_summary.items()
        if summary["spatialCv"].get("status") == "ready"
    }
    overall_weighted_metrics = {
        "cvMae": _weighted_average(
            [{"value": summary["cv"]["maeMean"], "weight": summary["trainingRows"]} for summary in per_type_summary.values()],
        ),
        "cvMape": _weighted_average(
            [{"value": summary["cv"]["mapeMean"], "weight": summary["trainingRows"]} for summary in per_type_summary.values()],
        ),
        "cvR2": _weighted_average(
            [{"value": summary["cv"]["r2Mean"], "weight": summary["trainingRows"]} for summary in per_type_summary.values()],
        ),
        "holdoutMae": _weighted_average(
            [{"value": summary["holdout"]["mae"], "weight": summary["holdoutRows"]} for summary in per_type_summary.values()],
        ),
        "holdoutMape": _weighted_average(
            [{"value": summary["holdout"]["mape"], "weight": summary["holdoutRows"]} for summary in per_type_summary.values()],
        ),
        "holdoutR2": _weighted_average(
            [{"value": summary["holdout"]["r2"], "weight": summary["holdoutRows"]} for summary in per_type_summary.values()],
        ),
        "randomHoldoutMae": _weighted_average(
            [{"value": summary["randomHoldout"]["mae"], "weight": summary["randomHoldout"]["rows"]} for summary in per_type_summary.values()],
        ),
        "spatialCvMae": _weighted_average(
            [
                {"value": spatial["spatialCvMae"], "weight": per_type_summary[property_type]["trainingRows"]}
                for property_type, spatial in ready_spatial.items()
            ],
        ),
        "spatialGeneralizationGapPct": _weighted_average(
            [
                {"value": spatial["spatialGeneralizationGapPct"], "weight": per_type_summary[property_type]["trainingRows"]}
                for property_type, spatial in ready_spatial.items()
            ],
        ),
    }

    evaluation_summary = {
        "selectedModels": model_families,
        "overallWeightedMetrics": overall_weighted_metrics,
        "validationStrategy": {
            "trainHoldoutSplit": temporal_split_strategy,
            "crossValidation": "adaptive 3 or 5 fold cross-validation per property type",
            "randomHoldoutSplit": "secondary 80/20 stratified by price band per property type",
            "bootstrap": f"{BOOTSTRAP_REPEATS} bootstrap resamples on each selected temporal holdout prediction set",
            "spatialValidation": f"GroupKFold by {SPATIAL_CV_GROUP_KEY} vs matched random KFold per property type",
            "uncertainty": f"split conformal calibration (alpha={CONFORMAL_ALPHA}) per property type",
            "shippedModel": "train-only fitted models; conformal intervals cover the shipped models on unseen holdout rows",
        },
        "perType": per_type_summary,
        "eda": eda_summary,
    }

    global_age_median = _safe_median(train_stats_frame["ageYears"], 0.0)
    age_medians = (
        train_stats_frame.groupby("propertyType")["ageYears"]
        .median()
        .fillna(global_age_median)
        .to_dict()
    )
    numeric_medians = train_stats_frame[numeric_features].median(numeric_only=True).fillna(0).to_dict()
    type_feature_medians = {
        property_type: {
            "livingAreaSqft": float(frame["livingAreaSqft"].median()),
            "bedrooms": float(frame["bedrooms"].median()),
            "bathrooms": float(frame["bathrooms"].median()),
            "ageYears": _safe_median(frame["ageYears"], numeric_medians["ageYears"]),
        }
        for property_type, frame in train_stats_frame.groupby("propertyType")
    }
    type_price_medians = {
        property_type: float(frame["price"].median())
        for property_type, frame in train_stats_frame.groupby("propertyType")
    }

    full_postal_stats = {
        (postal, property_type): _build_group_stats(frame)
        for (postal, property_type), frame in train_stats_frame.groupby(["postalCode", "propertyType"])
    }
    fsa_stats = {
        (postal_fsa, property_type): _build_group_stats(frame)
        for (postal_fsa, property_type), frame in train_stats_frame.groupby(["postalFsa", "propertyType"])
    }
    type_stats = {
        property_type: _build_group_stats(frame)
        for property_type, frame in train_stats_frame.groupby("propertyType")
    }
    market_stats = _build_group_stats(train_stats_frame)

    bundle = HalifaxModelBundle(
        models=models,
        model_families=model_families,
        candidate_metrics=candidate_metrics,
        evaluation_summary=evaluation_summary,
        conformal_calibrations=conformal_calibrations,
        model_version=MODEL_VERSION,
        training_mode=TRAINING_MODE,
        data_path=data_path,
        trained_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        row_counts=row_counts,
        location_clusterer=clusterer,
        cluster_count=CLUSTER_COUNT,
        location_feature_version=LOCATION_FEATURE_VERSION,
        full_postal_centroids=_centroid_lookup(train_stats_frame.groupby("postalCode")),
        fsa_centroids=_centroid_lookup(train_stats_frame.groupby("postalFsa")),
        market_centroid=(
            float(train_stats_frame["latitude"].median()),
            float(train_stats_frame["longitude"].median()),
        ),
        age_medians={key: float(value) for key, value in age_medians.items()},
        numeric_medians={key: float(value) for key, value in numeric_medians.items()},
        type_feature_medians=type_feature_medians,
        type_price_medians=type_price_medians,
        full_postal_stats=full_postal_stats,
        fsa_stats=fsa_stats,
        type_stats=type_stats,
        market_stats=market_stats,
        training_date_range=eda_summary["trainingDateRange"],
        time_adjustment_baseline_month=_time_adjustment_baseline_month(),
        numeric_features=numeric_features,
        categorical_features=categorical_features,
        conformal_coverage_waivers=conformal_coverage_waivers,
        xgboost_available=XGBOOST_AVAILABLE,
        xgboost_import_error=XGBOOST_IMPORT_ERROR,
    )

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with ARTIFACT_PATH.open("wb") as artifact_file:
        pickle.dump(bundle, artifact_file)

    upsert_manifest_entry(
        ARTIFACT_PATH,
        build_manifest_entry(
            ARTIFACT_PATH,
            model_version=bundle.model_version,
            trained_at=bundle.trained_at,
        ),
    )

    return bundle


def _bundle_validation_issues(bundle: HalifaxModelBundle) -> list[str]:
    return extended_bundle_validation_issues(
        bundle,
        expected_model_version=MODEL_VERSION,
        expected_location_feature_version=LOCATION_FEATURE_VERSION,
    )


def load_bundle() -> HalifaxModelBundle:
    global _BUNDLE

    if _BUNDLE is not None:
        return _BUNDLE

    _BUNDLE = load_approved_pickle(
        ARTIFACT_PATH,
        expected_type=HalifaxModelBundle,
        artifact_label="Halifax base-model",
        validate=_bundle_validation_issues,
    )
    return _BUNDLE


def _resolve_centroid(bundle: HalifaxModelBundle, postal_code: str) -> tuple[float, float]:
    if postal_code in bundle.full_postal_centroids:
        return bundle.full_postal_centroids[postal_code]

    postal_fsa = postal_code[:3]
    if postal_fsa in bundle.fsa_centroids:
        return bundle.fsa_centroids[postal_fsa]

    return bundle.market_centroid


def _location_feature_payload(bundle: HalifaxModelBundle, latitude: float, longitude: float) -> dict[str, Any]:
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        cluster_value = int(bundle.location_clusterer.predict(np.array([[latitude, longitude]], dtype=float))[0])
    return {
        "latitude": float(latitude),
        "longitude": float(longitude),
        "lat_x_lon": float(latitude * longitude),
        "lat_sq": float(latitude**2),
        "lon_sq": float(longitude**2),
        "submarketCluster": f"cluster-{cluster_value:02d}",
    }


def _choose_market_stats(bundle: HalifaxModelBundle, postal_code: str, property_type: str) -> tuple[str, str, dict[str, Any]]:
    full_stats = bundle.full_postal_stats.get((postal_code, property_type))
    if full_stats and full_stats["count"] >= 8:
        return "postal-code", f"Postal area {_format_postal_code(postal_code)}", full_stats

    postal_fsa = postal_code[:3]
    fsa_stats = bundle.fsa_stats.get((postal_fsa, property_type))
    if fsa_stats and fsa_stats["count"] >= 15:
        return "fsa", f"FSA {postal_fsa}", fsa_stats

    type_stats = bundle.type_stats.get(property_type)
    if type_stats and type_stats["count"] >= 25:
        return "city-property-type", f"{MARKET_LABEL} {property_type}", type_stats

    return "city", MARKET_LABEL, bundle.market_stats


def _market_freshness_payload(bundle: HalifaxModelBundle) -> dict[str, Any]:
    baseline_month = bundle.time_adjustment_baseline_month
    if baseline_month is None:
        return {
            "status": "embedded-in-target",
            "message": (
                "Sale prices were time-adjusted with the HRM monthly median sale-price index during training, "
                f"but the baseline month is missing from {SUMMARY_PATH}."
            ),
            "dataSource": FRESHNESS_DATA_SOURCE,
        }

    return {
        "status": "embedded-in-target",
        "message": f"Sale prices are time-adjusted to {baseline_month} with the HRM monthly median sale-price index during training.",
        "dataSource": FRESHNESS_DATA_SOURCE,
    }


def _percentile_rank(value: float, price_percentiles: list[float] | np.ndarray) -> float:
    percentiles = np.asarray(price_percentiles, dtype=float)
    if len(percentiles) < 2:
        return 50.0

    ranks = np.linspace(0, 100, len(percentiles))
    rank = float(np.interp(value, percentiles, ranks))
    return float(np.clip(rank, 1, 99))


def _driver_candidates(
    property_data: dict[str, Any],
    bundle: HalifaxModelBundle,
    local_stats: dict[str, Any],
) -> list[dict[str, Any]]:
    # Heuristic fallback when SHAP cannot run; mirrors the base model's market-stats drivers.
    property_type = property_data["propertyType"]
    medians = bundle.type_feature_medians.get(property_type, {})
    local_psf = local_stats["medianPricePerSqft"] or bundle.market_stats["medianPricePerSqft"]

    drivers = [
        {
            "label": "Local area pricing",
            "value": local_stats["medianPrice"] - bundle.market_stats["medianPrice"],
        },
        {
            "label": "Property type profile",
            "value": bundle.type_price_medians.get(property_type, bundle.market_stats["medianPrice"]) - bundle.market_stats["medianPrice"],
        },
        {
            "label": "Living area vs typical",
            "value": (property_data["livingAreaSqft"] - medians.get("livingAreaSqft", property_data["livingAreaSqft"])) * local_psf * 0.58,
        },
        {
            "label": "Bedrooms vs typical",
            "value": (property_data["bedrooms"] - medians.get("bedrooms", property_data["bedrooms"])) * 22_000,
        },
        {
            "label": "Bathrooms vs typical",
            "value": (property_data["bathrooms"] - medians.get("bathrooms", property_data["bathrooms"])) * 32_000,
        },
    ]

    age_years = property_data.get("ageYears")
    age_missing_rate = float(bundle.evaluation_summary["perType"].get(property_type, {}).get("ageYearsMissingRate", 1.0))
    if age_years is not None and age_missing_rate < 0.95:
        drivers.append(
            {
                "label": "Age vs typical",
                "value": (medians.get("ageYears", age_years) - age_years) * local_psf * 2.5,
            },
        )

    filtered = [driver for driver in drivers if abs(driver["value"]) >= 5_000]
    top_drivers = sorted(filtered, key=lambda item: abs(item["value"]), reverse=True)[:6]
    return [{"label": item["label"], "value": round(float(item["value"])), "source": "heuristic"} for item in top_drivers]


def _normalize_request(payload: dict[str, Any], bundle: HalifaxModelBundle) -> dict[str, Any]:
    property_type = str(payload.get("propertyType") or "").strip()
    if property_type == "Condo":
        raise ValueError(
            "Condo estimates are not available for Halifax / Maritimes: PVSC open data does not cover "
            "condo unit characteristics. Supported property types are Detached, Townhouse, and Duplex.",
        )
    if property_type not in PROPERTY_TYPES:
        raise ValueError("propertyType must be one of Detached, Townhouse, or Duplex for Halifax / Maritimes")

    postal_code = _normalize_postal_code(payload.get("postalCode"))
    if postal_code is None or not HALIFAX_PREFIX_PATTERN.match(postal_code):
        raise ValueError("postalCode must be a Halifax / Maritimes postal code starting with B plus a digit, like B3H 1A1")
    if postal_code[:3] not in bundle.fsa_centroids:
        raise ValueError(
            f"postal FSA {postal_code[:3]} is outside the Halifax model's observed training geography; "
            "no estimate was produced"
        )

    living_area = _parse_numeric(payload.get("livingAreaSqft"))
    bedrooms = _parse_numeric(payload.get("bedrooms"))
    bathrooms = _parse_numeric(payload.get("bathrooms"))
    age_years = _age_from_year_built(payload.get("yearBuilt"))
    known_current_value = _parse_numeric(payload.get("knownCurrentValue"))

    if living_area is None or living_area < 250:
        raise ValueError("livingAreaSqft must be at least 250")
    if bedrooms is None or bedrooms < 0:
        raise ValueError("bedrooms must be zero or greater")
    if bathrooms is None or bathrooms < 0:
        raise ValueError("bathrooms must be zero or greater")

    latitude, longitude = _resolve_centroid(bundle, postal_code)
    if age_years is None:
        age_years = bundle.age_medians.get(property_type, bundle.numeric_medians["ageYears"])

    return {
        "postalCode": postal_code,
        "postalFsa": postal_code[:3],
        "propertyType": property_type,
        "livingAreaSqft": float(living_area),
        "bedrooms": float(bedrooms),
        "bathrooms": float(bathrooms),
        "ageYears": float(age_years) if age_years is not None else None,
        "knownCurrentValue": float(known_current_value) if known_current_value is not None else None,
        **_location_feature_payload(bundle, latitude, longitude),
    }


def estimate_property(payload: dict[str, Any]) -> dict[str, Any]:
    bundle = load_bundle()
    property_data = _normalize_request(payload, bundle)
    property_type = property_data["propertyType"]

    feature_row: dict[str, Any] = {
        "postalFsa": property_data["postalFsa"],
        "submarketCluster": property_data["submarketCluster"],
        "livingAreaSqft": property_data["livingAreaSqft"],
        "bedrooms": property_data["bedrooms"],
        "bathrooms": property_data["bathrooms"],
        "latitude": property_data["latitude"],
        "longitude": property_data["longitude"],
        "lat_x_lon": property_data["lat_x_lon"],
        "lat_sq": property_data["lat_sq"],
        "lon_sq": property_data["lon_sq"],
        "ageYears": property_data["ageYears"],
    }
    if "assessedValue" in getattr(bundle, "numeric_features", NUMERIC_FEATURES):
        feature_row["assessedValue"] = np.nan
    if "h3Cell" in getattr(bundle, "categorical_features", CATEGORICAL_FEATURES):
        feature_row["h3Cell"] = _h3_cell_from_coordinates(property_data["latitude"], property_data["longitude"]) or "missing"

    feature_frame = pd.DataFrame([feature_row])

    predicted_log_price = float(bundle.models[property_type].predict(feature_frame)[0])
    base_value = round(float(np.exp(predicted_log_price)))
    calibration = bundle.conformal_calibrations[property_type]
    confidence_ratio = float(calibration.ratio)
    confidence_low = round(max(0, base_value * (1 - confidence_ratio)))
    confidence_high = round(base_value * (1 + confidence_ratio))
    anchor_value = round(property_data["knownCurrentValue"] or base_value)
    price_per_sqft = round(base_value / max(property_data["livingAreaSqft"], 1), 2)

    local_scope, local_area_label, local_stats = _choose_market_stats(bundle, property_data["postalCode"], property_type)
    percentile_rank = _percentile_rank(base_value, local_stats["pricePercentiles"])
    practical_ceiling = round(max(base_value, local_stats["practicalCeiling"]))

    drivers, explanation_method = shap_drivers(bundle.models[property_type], feature_frame, base_value)
    if drivers is None:
        drivers = _driver_candidates(property_data, bundle, local_stats)

    calibration_note = (
        f"Split conformal band ({calibration.target_coverage:.0%} target) calibrated on "
        f"{calibration.calibration_rows} held-out Halifax {property_type.lower()} sales"
    )
    if calibration.empirical_coverage is not None:
        calibration_note += f"; empirical coverage {calibration.empirical_coverage:.1%} on {calibration.coverage_rows} verification sales."
    else:
        calibration_note += "; too few holdout rows remained to verify coverage empirically."
    coverage_waiver = getattr(bundle, "conformal_coverage_waivers", {}).get(property_type)
    if coverage_waiver:
        calibration_note += f" {coverage_waiver['note']}"

    quality_summary = bundle.evaluation_summary["perType"][property_type]
    age_years_missing_rate = float(quality_summary["ageYearsMissingRate"])
    bedrooms_imputed_rate = float(quality_summary["bedroomsImputedRate"])
    validation_summary = {
        "trainHoldoutSplit": quality_summary["validationStrategy"]["trainHoldoutSplit"],
        "crossValidation": quality_summary["validationStrategy"]["crossValidation"],
        "bootstrap": quality_summary["validationStrategy"]["bootstrap"],
        "bootstrapRanges": {
            "mae": quality_summary["bootstrap"]["mae"],
            "mape": quality_summary["bootstrap"]["mape"],
            "r2": quality_summary["bootstrap"]["r2"],
        },
        "spatialValidation": quality_summary["validationStrategy"]["spatialValidation"],
        "spatialCv": quality_summary["spatialCv"],
        "uncertainty": quality_summary["validationStrategy"]["uncertainty"],
        "missingnessNotes": [
            f"Year built was missing for {age_years_missing_rate * 100:.1f}% of Halifax {property_type.lower()} sales and age is median-imputed by property type when not provided.",
            f"Bedrooms were imputed upstream (PVSC characteristic gaps) for {bedrooms_imputed_rate * 100:.1f}% of Halifax {property_type.lower()} training rows.",
        ],
        "locationFeatures": f"{bundle.location_feature_version} with {bundle.cluster_count} Halifax submarket clusters",
        "clusterCount": bundle.cluster_count,
    }

    return {
        "modelVersion": bundle.model_version,
        "trainingMode": bundle.training_mode,
        "modelFamily": bundle.model_families[property_type],
        "modelScope": property_type,
        "market": MARKET_ID,
        "marketLabel": MARKET_LABEL,
        "baseValue": base_value,
        "confidenceLow": confidence_low,
        "confidenceHigh": confidence_high,
        "anchorValue": anchor_value,
        "pricePerSqft": price_per_sqft,
        "confidenceRatio": round(confidence_ratio, 4),
        "uncertainty": {
            "method": "conformal",
            "targetCoverage": round(float(calibration.target_coverage), 4),
            "empiricalCoverage": round(float(calibration.empirical_coverage), 4) if calibration.empirical_coverage is not None else None,
            "calibrationNote": calibration_note,
            "coverageWaiver": coverage_waiver,
        },
        "modelQuality": {
            "trainingRows": int(quality_summary["trainingRows"]),
            "cvMae": round(float(quality_summary["cv"]["maeMean"])),
            "cvMape": float(quality_summary["cv"]["mapeMean"]),
            "cvR2": float(quality_summary["cv"]["r2Mean"]),
            "holdoutMae": round(float(quality_summary["holdout"]["mae"])),
            "holdoutMape": float(quality_summary["holdout"]["mape"]),
            "holdoutR2": float(quality_summary["holdout"]["r2"]),
            "outlierRemovedRate": 0.0,
            "validationSummary": validation_summary,
        },
        "drivers": drivers,
        "explanationMethod": explanation_method,
        "marketContext": {
            "localAreaLabel": local_area_label,
            "localAreaScope": local_scope,
            "localMedianValue": round(local_stats["medianPrice"]),
            "localMedianPricePerSqft": round(local_stats["medianPricePerSqft"], 2),
            "cityMedianValue": round(bundle.market_stats["medianPrice"]),
            "cityMedianPricePerSqft": round(bundle.market_stats["medianPricePerSqft"], 2),
            # Deprecated aliases kept for response-shape compatibility; same values as cityMedian*.
            "vancouverMedianValue": round(bundle.market_stats["medianPrice"]),
            "vancouverMedianPricePerSqft": round(bundle.market_stats["medianPricePerSqft"], 2),
            "percentileRank": round(percentile_rank, 1),
            "practicalCeiling": practical_ceiling,
            "premiumGap": round(base_value - local_stats["medianPrice"]),
            "comparableCount": int(local_stats["count"]),
        },
        "marketFreshness": _market_freshness_payload(bundle),
        "dataSources": DATA_SOURCES,
        "modelNotes": MODEL_NOTES,
    }


def slim_health_payload() -> dict[str, Any]:
    bundle = load_bundle()
    return {
        "ok": True,
        "market": MARKET_ID,
        "marketLabel": MARKET_LABEL,
        "modelVersion": bundle.model_version,
        "trainedAt": bundle.trained_at,
        "rowCounts": bundle.row_counts,
    }


def metrics_payload() -> dict[str, Any]:
    bundle = load_bundle()
    return {
        "market": MARKET_ID,
        "marketLabel": MARKET_LABEL,
        "service": "model-service",
        "modelVersion": bundle.model_version,
        "trainingMode": bundle.training_mode,
        "dataPath": _display_path(bundle.data_path),
        "trainedAt": bundle.trained_at,
        "rowCounts": bundle.row_counts,
        "trainingDateRange": bundle.training_date_range,
        "timeAdjustmentBaselineMonth": bundle.time_adjustment_baseline_month,
        "modelFamilies": bundle.model_families,
        "perTypeCandidateMetrics": bundle.candidate_metrics,
        "overallWeightedMetrics": bundle.evaluation_summary["overallWeightedMetrics"],
        "evaluationSummary": bundle.evaluation_summary,
        "locationFeatureVersion": bundle.location_feature_version,
        "clusterCount": bundle.cluster_count,
        "dataSources": DATA_SOURCES,
        "modelNotes": MODEL_NOTES,
        "xgboostAvailable": bundle.xgboost_available,
        "xgboostImportError": bundle.xgboost_import_error,
    }


def halifax_health_payload() -> dict[str, Any]:
    return slim_health_payload()
