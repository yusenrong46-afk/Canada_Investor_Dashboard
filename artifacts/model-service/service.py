from __future__ import annotations

import math
import os
import pickle
import re
from dataclasses import dataclass
from datetime import datetime
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
from sklearn.model_selection import KFold, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

try:
    from xgboost import XGBRegressor

    XGBOOST_AVAILABLE = True
    XGBOOST_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - depends on local OpenMP runtime
    XGBRegressor = None
    XGBOOST_AVAILABLE = False
    XGBOOST_IMPORT_ERROR = str(exc)

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = Path(__file__).resolve().parent / "models"
ARTIFACT_PATH = ARTIFACT_DIR / "vancouver_base_price_bundle_v4.pkl"
MODEL_VERSION = "vancouver-base-price-v4"
TRAINING_MODE = "vancouver-real-listings"
LOCATION_FEATURE_VERSION = "latlon-polynomial-cluster-v1"
CLUSTER_COUNT = 12
BOOTSTRAP_REPEATS = 400
DEFAULT_DATA_PATH = os.environ.get(
    "VANCOUVER_LISTINGS_CSV_PATH",
    "/Users/thomas/Downloads/CanadaHousingData/data_bc.csv",
)
DEFAULT_MARKET_INDEX_PATH = os.environ.get(
    "VANCOUVER_MARKET_INDEX_CSV_PATH",
    str(REPO_ROOT / "data" / "raw" / "market" / "vancouver_market_index.csv"),
)

PROPERTY_TYPES = ["Detached", "Townhouse", "Condo", "Duplex"]
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
VANCOUVER_PREFIXES = ("V5", "V6")


@dataclass
class VancouverModelBundle:
    models: dict[str, Pipeline]
    model_families: dict[str, str]
    candidate_metrics: dict[str, dict[str, dict[str, Any]]]
    evaluation_summary: dict[str, Any]
    confidence_error_ratios: dict[str, float]
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
    vancouver_centroid: tuple[float, float]
    age_medians: dict[str, float]
    numeric_medians: dict[str, float]
    type_feature_medians: dict[str, dict[str, float]]
    type_price_medians: dict[str, float]
    full_postal_stats: dict[tuple[str, str], dict[str, Any]]
    fsa_stats: dict[tuple[str, str], dict[str, Any]]
    type_stats: dict[str, dict[str, Any]]
    city_stats: dict[str, Any]
    training_date_range: dict[str, str | None]
    market_index_path: str
    xgboost_available: bool
    xgboost_import_error: str | None


_BUNDLE: VancouverModelBundle | None = None


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


def _parse_date(value: Any) -> pd.Timestamp | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None

    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None

    return pd.Timestamp(parsed).tz_localize(None)


def _numeric_column(frame: pd.DataFrame, names: list[str]) -> pd.Series:
    for name in names:
        if name in frame.columns:
            return frame[name].map(_parse_numeric)
    return pd.Series(np.nan, index=frame.index, dtype=float)


def _first_existing_name(frame: pd.DataFrame, names: list[str]) -> str | None:
    for name in names:
        if name in frame.columns:
            return name
    return None


def _date_column(frame: pd.DataFrame, names: list[str]) -> pd.Series:
    for name in names:
        if name in frame.columns:
            return frame[name].map(_parse_date)
    return pd.Series(pd.NaT, index=frame.index, dtype="datetime64[ns]")


def _age_from_year_built(year_built: Any) -> float | None:
    parsed = _parse_numeric(year_built)
    if parsed is None:
        return None

    current_year = datetime.utcnow().year
    if parsed < 1800 or parsed > current_year:
        return None

    return float(np.clip(current_year - parsed, 0, 225))


def _derive_age_years(year_built: pd.Series, approx_age: pd.Series) -> pd.Series:
    current_year = datetime.utcnow().year
    year_based_age = current_year - year_built.astype(float)
    year_based_age = year_based_age.where(year_built.between(1800, current_year))
    clean_approx_age = approx_age.where(approx_age.between(0, 225))
    age_years = clean_approx_age.combine_first(year_based_age)
    return age_years.where(age_years.between(0, 225))


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


def _normalize_property_type(property_type: Any, type_value: Any) -> str | None:
    merged = " ".join(
        part.strip().lower()
        for part in [str(property_type or "").strip(), str(type_value or "").strip()]
        if part and str(part).strip()
    )

    if not merged:
        return None

    merged = merged.replace("&", " ")
    merged = merged.replace("-", " ")

    if "condo/townhome" in merged or "condo townhouse" in merged:
        return None
    if "vacant" in merged or "land" in merged or "multi" in merged:
        return None
    if "townhome" in merged or "townhouse" in merged:
        return "Townhouse"
    if "duplex" in merged:
        return "Duplex"
    if "single family" in merged or "detached" in merged or "house" in merged:
        return "Detached"
    if "condo" in merged or "apartment" in merged:
        return "Condo"

    return None


def _iqr_bounds(series: pd.Series, multiplier: float) -> tuple[float, float]:
    values = series.dropna().astype(float)
    if values.empty:
        return -math.inf, math.inf

    q1 = float(values.quantile(0.25))
    q3 = float(values.quantile(0.75))
    iqr = q3 - q1
    if not np.isfinite(iqr) or iqr <= 0:
        return float(values.min()), float(values.max())

    return q1 - multiplier * iqr, q3 + multiplier * iqr


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


def _remove_segment_outliers(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    keep_mask = pd.Series(True, index=frame.index, dtype=bool)
    removal_reasons = pd.DataFrame(
        False,
        index=frame.index,
        columns=["typePricePerSqft", "typeLivingArea", "localPricePerSqft"],
    )

    before_counts = frame.groupby("propertyType").size().to_dict()

    for property_type, group in frame.groupby("propertyType"):
        if len(group) < 25:
            continue

        psf_low, psf_high = _iqr_bounds(group["pricePerSqft"], multiplier=3.0)
        area_low, area_high = _iqr_bounds(group["livingAreaSqft"], multiplier=3.5)

        type_psf_mask = group["pricePerSqft"].between(psf_low, psf_high)
        type_area_mask = group["livingAreaSqft"].between(area_low, area_high)

        keep_mask.loc[group.index] &= type_psf_mask & type_area_mask
        removal_reasons.loc[group.index, "typePricePerSqft"] = ~type_psf_mask
        removal_reasons.loc[group.index, "typeLivingArea"] = ~type_area_mask

        for postal_fsa, local_group in group.groupby("postalFsa"):
            if len(local_group) < 40:
                continue

            local_low, local_high = _iqr_bounds(local_group["pricePerSqft"], multiplier=3.5)
            local_mask = local_group["pricePerSqft"].between(local_low, local_high)
            keep_mask.loc[local_group.index] &= local_mask
            removal_reasons.loc[local_group.index, "localPricePerSqft"] = ~local_mask

    filtered = frame.loc[keep_mask].copy()
    removed_mask = ~keep_mask

    by_property_type: dict[str, dict[str, Any]] = {}
    for property_type in PROPERTY_TYPES:
        before = int(before_counts.get(property_type, 0))
        removed = int((removed_mask & frame["propertyType"].eq(property_type)).sum())
        kept = before - removed
        by_property_type[property_type] = {
            "before": before,
            "removed": removed,
            "kept": kept,
            "removedRate": float(removed / before) if before else 0.0,
        }

    summary = {
        "removedRows": int(removed_mask.sum()),
        "keptRows": int(keep_mask.sum()),
        "removedRate": float(removed_mask.mean()),
        "byReason": {
            column: int(removal_reasons.loc[removed_mask, column].sum())
            for column in removal_reasons.columns
        },
        "byPropertyType": by_property_type,
    }

    return filtered, summary


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


def _load_training_frame(data_path: str) -> tuple[pd.DataFrame, dict[str, int], dict[str, Any], KMeans]:
    source = pd.read_csv(data_path, low_memory=False)
    total_rows = len(source)

    vancouver_mask = source["addressLocality"].fillna("").astype(str).str.strip().str.casefold() == "vancouver"
    vancouver = source.loc[vancouver_mask].copy()
    vancouver_rows = len(vancouver)

    vancouver["propertyType"] = [
        _normalize_property_type(row.get("Property Type"), row.get("Type"))
        for _, row in vancouver.iterrows()
    ]
    vancouver["price"] = vancouver["price"].map(_parse_numeric)
    vancouver["livingAreaSqft"] = vancouver["property-sqft"].map(_parse_numeric)
    vancouver["bedrooms"] = vancouver["property-beds"].map(_parse_numeric)
    vancouver["bathrooms"] = vancouver["property-baths"].map(_parse_numeric)
    vancouver["yearBuilt"] = _numeric_column(vancouver, ["Year Built", "yearBuilt", "year_built"])
    vancouver["approxAge"] = _numeric_column(vancouver, ["Approx Age", "ApproxAge", "approxAge"])
    vancouver["ageYears"] = _derive_age_years(vancouver["yearBuilt"], vancouver["approxAge"])
    vancouver["listingDate"] = _date_column(vancouver, ["Date Listed", "Last Updated", "dateListed", "lastUpdated"])
    vancouver["latitude"] = vancouver["latitude"].map(_parse_numeric)
    vancouver["longitude"] = vancouver["longitude"].map(_parse_numeric)
    vancouver["postalCode"] = vancouver["postalCode"].map(_normalize_postal_code)
    vancouver["postalFsa"] = vancouver["postalCode"].str[:3]

    relevant_columns = [
        "price",
        "livingAreaSqft",
        "bedrooms",
        "bathrooms",
        "postalCode",
        "latitude",
        "longitude",
        "ageYears",
        "propertyType",
    ]
    typed_rows = vancouver[vancouver["propertyType"].isin(PROPERTY_TYPES)].copy()
    missingness = _missingness_report(vancouver, relevant_columns)
    missingness_by_property_type = {
        property_type: _missingness_report(
            group,
            [
                "price",
                "livingAreaSqft",
                "bedrooms",
                "bathrooms",
                "postalCode",
                "latitude",
                "longitude",
                "ageYears",
            ],
        )
        for property_type, group in typed_rows.groupby("propertyType")
    }

    usable_pre_outlier = vancouver[
        vancouver["propertyType"].isin(PROPERTY_TYPES)
        & vancouver["price"].notna()
        & vancouver["livingAreaSqft"].notna()
        & vancouver["bedrooms"].notna()
        & vancouver["bathrooms"].notna()
        & vancouver["postalCode"].notna()
        & vancouver["latitude"].notna()
        & vancouver["longitude"].notna()
    ].copy()

    usable_pre_outlier = usable_pre_outlier[
        usable_pre_outlier["livingAreaSqft"].between(250, 10_000)
        & usable_pre_outlier["bedrooms"].between(0, 10)
        & usable_pre_outlier["bathrooms"].between(0, 10)
        & usable_pre_outlier["price"].between(100_000, 25_000_000)
        & usable_pre_outlier["latitude"].between(48.9, 49.4)
        & usable_pre_outlier["longitude"].between(-123.4, -122.8)
        & usable_pre_outlier["postalFsa"].fillna("").str.startswith(VANCOUVER_PREFIXES)
    ].copy()

    usable_pre_outlier["ageYears"] = usable_pre_outlier["ageYears"].where(usable_pre_outlier["ageYears"].between(0, 225))
    if usable_pre_outlier["ageYears"].notna().sum() == 0:
        usable_pre_outlier["ageYears"] = 0.0
    usable_pre_outlier["pricePerSqft"] = usable_pre_outlier["price"] / usable_pre_outlier["livingAreaSqft"]

    usable, outlier_summary = _remove_segment_outliers(usable_pre_outlier)
    usable["ageYears"] = usable["ageYears"].where(usable["ageYears"].between(0, 225))
    if usable["ageYears"].notna().sum() == 0:
        usable["ageYears"] = 0.0
    usable["pricePerSqft"] = usable["price"] / usable["livingAreaSqft"]
    usable["logPrice"] = np.log(usable["price"])
    usable, clusterer = _engineer_location_features(usable)

    row_counts = {
        "totalRows": int(total_rows),
        "vancouverRows": int(vancouver_rows),
        "usableRowsBeforeOutlierRemoval": int(len(usable_pre_outlier)),
        "usableRows": int(len(usable)),
    }
    listing_dates = usable["listingDate"].dropna()
    training_date_range = {
        "firstListingDate": listing_dates.min().date().isoformat() if not listing_dates.empty else None,
        "latestListingDate": listing_dates.max().date().isoformat() if not listing_dates.empty else None,
    }

    eda_summary = {
        "missingness": missingness,
        "missingnessByPropertyType": missingness_by_property_type,
        "trainingDateRange": training_date_range,
        "targetDistributionBeforeOutlierRemoval": _distribution_summary(usable_pre_outlier["price"]),
        "targetDistributionAfterOutlierRemoval": _distribution_summary(usable["price"]),
        "pricePerSqftDistributionAfterOutlierRemoval": _distribution_summary(usable["pricePerSqft"]),
        "outlierRemoval": outlier_summary,
    }

    return usable, row_counts, eda_summary, clusterer


def _build_preprocessor() -> ColumnTransformer:
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
            ("num", numeric_pipeline, NUMERIC_FEATURES),
            ("cat", categorical_pipeline, CATEGORICAL_FEATURES),
        ],
        remainder="drop",
    )


def _build_candidate_pipelines() -> dict[str, Pipeline]:
    pipelines: dict[str, Pipeline] = {
        "random-forest": Pipeline(
            [
                ("prep", _build_preprocessor()),
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
                ("prep", _build_preprocessor()),
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
        "errorRatios": abs_pct.tolist(),
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
        sample_actual = actual[sample_index]
        sample_predicted = predicted[sample_index]
        metrics = _evaluate_predictions(sample_actual, sample_predicted)
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


def _build_group_stats(group: pd.DataFrame) -> dict[str, Any]:
    prices = np.sort(group["price"].to_numpy(dtype=float))
    return {
        "count": int(len(group)),
        "medianPrice": float(np.median(prices)),
        "medianPricePerSqft": float(np.median(group["pricePerSqft"].to_numpy(dtype=float))),
        "practicalCeiling": float(np.quantile(prices, 0.95)),
        "pricesSorted": prices,
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


def _train_property_type_model(property_type: str, frame: pd.DataFrame) -> tuple[Pipeline, str, dict[str, dict[str, Any]], float, dict[str, Any]]:
    feature_frame = frame[NUMERIC_FEATURES + CATEGORICAL_FEATURES].copy()
    target = frame["logPrice"]
    price_strata = _build_price_strata(frame["price"])

    stratify = price_strata if price_strata.nunique() > 1 else None
    train_index, test_index = train_test_split(
        frame.index.to_numpy(),
        test_size=0.2,
        random_state=42,
        stratify=stratify,
    )

    x_train = feature_frame.loc[train_index]
    x_test = feature_frame.loc[test_index]
    y_train = target.loc[train_index].to_numpy(dtype=float)
    actual_prices = frame.loc[test_index, "price"].to_numpy(dtype=float)
    train_strata = price_strata.loc[train_index]
    cv_splitter = _select_cv_splitter(train_strata)

    candidate_metrics: dict[str, dict[str, Any]] = {}
    pipeline_builders = _build_candidate_pipelines()

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
            cv_actual = frame.loc[cv_valid_index, "price"].to_numpy(dtype=float)
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
                "rows": int(len(test_index)),
                "mae": holdout_metrics["mae"],
                "rmse": holdout_metrics["rmse"],
                "mape": holdout_metrics["mape"],
                "r2": holdout_metrics["r2"],
            },
            "_errorRatios": holdout_metrics["errorRatios"],
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
    selected_pipeline.fit(feature_frame, target.to_numpy(dtype=float))

    confidence_error_ratio = float(
        np.clip(
            np.quantile(candidate_metrics[selected_family].pop("_errorRatios"), 0.7),
            0.08,
            0.24,
        ),
    )
    holdout_predictions = np.array(candidate_metrics[selected_family].pop("_holdoutPredictions"), dtype=float)
    bootstrap_summary = _bootstrap_metric_summary(actual_prices, holdout_predictions)

    selected_metrics = candidate_metrics[selected_family]
    evaluation = {
        "propertyType": property_type,
        "selectedModel": selected_family,
        "trainingRows": int(len(frame)),
        "holdoutRows": int(selected_metrics["holdout"]["rows"]),
        "cv": selected_metrics["cv"],
        "holdout": selected_metrics["holdout"],
        "bootstrap": bootstrap_summary,
        "validationStrategy": {
            "trainHoldoutSplit": f"80/20 stratified by price band within Vancouver {property_type} listings",
            "crossValidation": f"{selected_metrics['cv']['folds']}-fold cross-validation inside Vancouver {property_type} listings",
            "bootstrap": f"{bootstrap_summary['repeats']} bootstrap resamples on the Vancouver {property_type} holdout predictions",
        },
    }

    for metric in candidate_metrics.values():
        metric.pop("_errorRatios", None)
        metric.pop("_holdoutPredictions", None)

    return selected_pipeline, selected_family, candidate_metrics, confidence_error_ratio, evaluation


def train_bundle(data_path: str = DEFAULT_DATA_PATH) -> VancouverModelBundle:
    usable, row_counts, eda_summary, clusterer = _load_training_frame(data_path)
    if usable.empty:
        raise ValueError("No Vancouver training rows were found after cleaning the CSV")

    models: dict[str, Pipeline] = {}
    model_families: dict[str, str] = {}
    candidate_metrics: dict[str, dict[str, dict[str, Any]]] = {}
    confidence_error_ratios: dict[str, float] = {}
    per_type_summary: dict[str, dict[str, Any]] = {}

    for property_type, frame in usable.groupby("propertyType"):
        model, family, metrics, confidence_ratio, evaluation = _train_property_type_model(property_type, frame)
        models[property_type] = model
        model_families[property_type] = family
        candidate_metrics[property_type] = metrics
        confidence_error_ratios[property_type] = confidence_ratio

        missingness_for_type = eda_summary["missingnessByPropertyType"].get(property_type, {})
        outlier_for_type = eda_summary["outlierRemoval"]["byPropertyType"].get(property_type, {})
        evaluation["ageYearsMissingRate"] = float(missingness_for_type.get("ageYears", {}).get("missingRate", 0.0))
        evaluation["outlierRemovedRate"] = float(outlier_for_type.get("removedRate", 0.0))
        evaluation["outlierRemovedRows"] = int(outlier_for_type.get("removed", 0))
        per_type_summary[property_type] = evaluation

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
    }

    evaluation_summary = {
        "selectedModels": model_families,
        "overallWeightedMetrics": overall_weighted_metrics,
        "validationStrategy": {
            "trainHoldoutSplit": "80/20 stratified by price band within each property type",
            "crossValidation": "adaptive 3 or 5 fold cross-validation per property type",
            "bootstrap": f"{BOOTSTRAP_REPEATS} bootstrap resamples on each selected holdout prediction set",
        },
        "perType": per_type_summary,
        "eda": eda_summary,
    }

    global_age_median = _safe_median(usable["ageYears"], 0.0)
    age_medians = (
        usable.groupby("propertyType")["ageYears"]
        .median()
        .fillna(global_age_median)
        .to_dict()
    )
    numeric_medians = usable[NUMERIC_FEATURES].median(numeric_only=True).fillna(0).to_dict()
    type_feature_medians = {
        property_type: {
            "livingAreaSqft": float(frame["livingAreaSqft"].median()),
            "bedrooms": float(frame["bedrooms"].median()),
            "bathrooms": float(frame["bathrooms"].median()),
            "ageYears": _safe_median(frame["ageYears"], numeric_medians["ageYears"]),
        }
        for property_type, frame in usable.groupby("propertyType")
    }
    type_price_medians = {
        property_type: float(frame["price"].median())
        for property_type, frame in usable.groupby("propertyType")
    }

    full_postal_stats = {
        (postal, property_type): _build_group_stats(frame)
        for (postal, property_type), frame in usable.groupby(["postalCode", "propertyType"])
    }
    fsa_stats = {
        (postal_fsa, property_type): _build_group_stats(frame)
        for (postal_fsa, property_type), frame in usable.groupby(["postalFsa", "propertyType"])
    }
    type_stats = {
        property_type: _build_group_stats(frame)
        for property_type, frame in usable.groupby("propertyType")
    }
    city_stats = _build_group_stats(usable)

    bundle = VancouverModelBundle(
        models=models,
        model_families=model_families,
        candidate_metrics=candidate_metrics,
        evaluation_summary=evaluation_summary,
        confidence_error_ratios=confidence_error_ratios,
        model_version=MODEL_VERSION,
        training_mode=TRAINING_MODE,
        data_path=data_path,
        trained_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
        row_counts=row_counts,
        location_clusterer=clusterer,
        cluster_count=CLUSTER_COUNT,
        location_feature_version=LOCATION_FEATURE_VERSION,
        full_postal_centroids=_centroid_lookup(usable.groupby("postalCode")),
        fsa_centroids=_centroid_lookup(usable.groupby("postalFsa")),
        vancouver_centroid=(
            float(usable["latitude"].median()),
            float(usable["longitude"].median()),
        ),
        age_medians={key: float(value) for key, value in age_medians.items()},
        numeric_medians={key: float(value) for key, value in numeric_medians.items()},
        type_feature_medians=type_feature_medians,
        type_price_medians=type_price_medians,
        full_postal_stats=full_postal_stats,
        fsa_stats=fsa_stats,
        type_stats=type_stats,
        city_stats=city_stats,
        training_date_range=eda_summary["trainingDateRange"],
        market_index_path=DEFAULT_MARKET_INDEX_PATH,
        xgboost_available=XGBOOST_AVAILABLE,
        xgboost_import_error=XGBOOST_IMPORT_ERROR,
    )

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with ARTIFACT_PATH.open("wb") as artifact_file:
        pickle.dump(bundle, artifact_file)

    return bundle


def load_bundle(force_retrain: bool = False, data_path: str = DEFAULT_DATA_PATH) -> VancouverModelBundle:
    global _BUNDLE

    if _BUNDLE is not None and not force_retrain and _BUNDLE.data_path == data_path:
        _BUNDLE.market_index_path = DEFAULT_MARKET_INDEX_PATH
        return _BUNDLE

    if not force_retrain and ARTIFACT_PATH.exists():
        try:
            with ARTIFACT_PATH.open("rb") as artifact_file:
                bundle = pickle.load(artifact_file)
            if isinstance(bundle, VancouverModelBundle) and bundle.data_path == data_path:
                bundle.market_index_path = DEFAULT_MARKET_INDEX_PATH
                _BUNDLE = bundle
                return bundle
        except Exception:
            pass

    _BUNDLE = train_bundle(data_path=data_path)
    return _BUNDLE


def _resolve_centroid(bundle: VancouverModelBundle, postal_code: str) -> tuple[float, float]:
    if postal_code in bundle.full_postal_centroids:
        return bundle.full_postal_centroids[postal_code]

    postal_fsa = postal_code[:3]
    if postal_fsa in bundle.fsa_centroids:
        return bundle.fsa_centroids[postal_fsa]

    return bundle.vancouver_centroid


def _location_feature_payload(bundle: VancouverModelBundle, latitude: float, longitude: float) -> dict[str, Any]:
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


def _choose_market_stats(bundle: VancouverModelBundle, postal_code: str, property_type: str) -> tuple[str, str, dict[str, Any]]:
    full_stats = bundle.full_postal_stats.get((postal_code, property_type))
    if full_stats and full_stats["count"] >= 8:
        return "postal-code", f"Postal area {_format_postal_code(postal_code)}", full_stats

    postal_fsa = postal_code[:3]
    fsa_stats = bundle.fsa_stats.get((postal_fsa, property_type))
    if fsa_stats and fsa_stats["count"] >= 15:
        return "fsa", f"FSA {postal_fsa}", fsa_stats

    type_stats = bundle.type_stats.get(property_type)
    if type_stats and type_stats["count"] >= 25:
        return "city-property-type", f"Vancouver {property_type}", type_stats

    return "city", "Vancouver", bundle.city_stats


def _normalize_market_property_type(value: Any) -> str | None:
    normalized = _normalize_property_type(value, "")
    if normalized:
        return normalized

    text = str(value or "").strip().casefold()
    if not text or any(term in text for term in ["all", "total", "composite", "aggregate", "benchmark"]):
        return "All"

    return None


def _market_freshness_payload(bundle: VancouverModelBundle, property_type: str) -> dict[str, Any]:
    path = Path(bundle.market_index_path)
    if not path.exists():
        return {
            "status": "not-applied",
            "message": f"No real current-market index CSV found at {path}. Base estimate uses the Vancouver listing data only.",
            "dataSource": str(path),
        }

    try:
        source = pd.read_csv(path, low_memory=False)
    except Exception as exc:
        return {
            "status": "not-applied",
            "message": f"Could not read the real market index CSV: {exc}",
            "dataSource": str(path),
        }

    date_column = _first_existing_name(source, ["date", "Date", "month", "Month", "period", "Period", "reportDate", "Report Date"])
    value_column = _first_existing_name(
        source,
        ["benchmarkPrice", "Benchmark Price", "benchmark_price", "price", "Price", "hpi", "HPI", "index", "Index"],
    )

    if date_column is None or value_column is None:
        return {
            "status": "not-applied",
            "message": "Market index CSV must include a date/month/period column and a benchmark price, HPI, or index column.",
            "dataSource": str(path),
        }

    market = pd.DataFrame(
        {
            "period": source[date_column].map(_parse_date),
            "value": source[value_column].map(_parse_numeric),
        },
    )

    region_column = _first_existing_name(source, ["region", "Region", "area", "Area", "market", "Market", "name", "Name"])
    if region_column is not None:
        region_mask = source[region_column].fillna("").astype(str).str.contains("vancouver", case=False, na=False)
        if region_mask.any():
            market = market.loc[region_mask].copy()

    type_column = _first_existing_name(source, ["propertyType", "Property Type", "type", "Type", "homeType", "Home Type"])
    if type_column is not None:
        market["propertyType"] = source.loc[market.index, type_column].map(_normalize_market_property_type)
        exact_type_rows = market[market["propertyType"] == property_type]
        all_type_rows = market[market["propertyType"] == "All"]
        if not exact_type_rows.empty:
            market = exact_type_rows.copy()
        elif not all_type_rows.empty:
            market = all_type_rows.copy()

    market = market.dropna(subset=["period", "value"])
    market = market[market["value"] > 0]
    if len(market) < 2:
        return {
            "status": "not-applied",
            "message": "Market index CSV did not contain enough usable real rows to calculate a current adjustment.",
            "dataSource": str(path),
        }

    market = market.groupby("period", as_index=False)["value"].mean().sort_values("period")
    baseline_period = _parse_date(bundle.training_date_range.get("latestListingDate"))
    if baseline_period is None:
        return {
            "status": "not-applied",
            "message": "Training listing dates were not available, so no current-market adjustment was applied.",
            "dataSource": str(path),
        }

    baseline_candidates = market[market["period"] <= baseline_period]
    baseline_row = baseline_candidates.iloc[-1] if not baseline_candidates.empty else market.iloc[0]
    latest_row = market.iloc[-1]

    if latest_row["period"] <= baseline_row["period"]:
        return {
            "status": "not-applied",
            "message": "Market index CSV is not newer than the training listing data, so no current adjustment was needed.",
            "baselinePeriod": baseline_row["period"].date().isoformat(),
            "latestPeriod": latest_row["period"].date().isoformat(),
            "dataSource": str(path),
        }

    multiplier = float(latest_row["value"] / baseline_row["value"])
    if not np.isfinite(multiplier) or multiplier < 0.5 or multiplier > 2.0:
        return {
            "status": "not-applied",
            "message": "Market index multiplier looked outside a safe range, so the real-data adjustment was not applied.",
            "baselinePeriod": baseline_row["period"].date().isoformat(),
            "latestPeriod": latest_row["period"].date().isoformat(),
            "dataSource": str(path),
        }

    return {
        "status": "adjusted",
        "message": "Applied a real current-market index multiplier to move the Vancouver listing model closer to today's market.",
        "multiplier": round(multiplier, 4),
        "baselinePeriod": baseline_row["period"].date().isoformat(),
        "latestPeriod": latest_row["period"].date().isoformat(),
        "dataSource": str(path),
    }


def _percentile_rank(value: float, sorted_prices: np.ndarray) -> float:
    if len(sorted_prices) == 0:
        return 50.0

    rank = np.searchsorted(sorted_prices, value, side="right") / len(sorted_prices)
    return float(np.clip(rank * 100, 1, 99))


def _driver_candidates(
    property_data: dict[str, Any],
    bundle: VancouverModelBundle,
    local_stats: dict[str, Any],
    market_multiplier: float,
) -> list[dict[str, Any]]:
    property_type = property_data["propertyType"]
    medians = bundle.type_feature_medians.get(property_type, {})
    local_psf = (local_stats["medianPricePerSqft"] or bundle.city_stats["medianPricePerSqft"]) * market_multiplier

    drivers = [
        {
            "label": "Local area pricing",
            "value": (local_stats["medianPrice"] - bundle.city_stats["medianPrice"]) * market_multiplier,
        },
        {
            "label": "Property type profile",
            "value": (
                bundle.type_price_medians.get(property_type, bundle.city_stats["medianPrice"]) - bundle.city_stats["medianPrice"]
            )
            * market_multiplier,
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
    return [{"label": item["label"], "value": round(float(item["value"]))} for item in top_drivers]


def _normalize_request(payload: dict[str, Any], bundle: VancouverModelBundle) -> dict[str, Any]:
    property_type = str(payload.get("propertyType") or "").strip()
    if property_type not in PROPERTY_TYPES:
        raise ValueError("propertyType must be one of Detached, Townhouse, Condo, or Duplex")

    postal_code = _normalize_postal_code(payload.get("postalCode"))
    if postal_code is None or not postal_code.startswith(VANCOUVER_PREFIXES):
        raise ValueError("postalCode must be a Vancouver postal code in V5 or V6")

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

    feature_frame = pd.DataFrame(
        [
            {
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
            },
        ],
    )

    predicted_log_price = float(bundle.models[property_type].predict(feature_frame)[0])
    raw_base_value = round(float(np.exp(predicted_log_price)))
    market_freshness = _market_freshness_payload(bundle, property_type)
    market_multiplier = float(market_freshness.get("multiplier", 1.0)) if market_freshness["status"] == "adjusted" else 1.0
    base_value = round(raw_base_value * market_multiplier)
    confidence_ratio = bundle.confidence_error_ratios[property_type]
    confidence_low = round(max(0, base_value * (1 - confidence_ratio)))
    confidence_high = round(base_value * (1 + confidence_ratio))
    anchor_value = round(property_data["knownCurrentValue"] or base_value)
    price_per_sqft = round(base_value / max(property_data["livingAreaSqft"], 1), 2)

    local_scope, local_area_label, local_stats = _choose_market_stats(bundle, property_data["postalCode"], property_type)
    percentile_rank = _percentile_rank(raw_base_value, local_stats["pricesSorted"])
    practical_ceiling = round(max(base_value, local_stats["practicalCeiling"] * market_multiplier))

    quality_summary = bundle.evaluation_summary["perType"][property_type]
    age_years_missing_rate = float(quality_summary["ageYearsMissingRate"])
    validation_summary = {
        "trainHoldoutSplit": quality_summary["validationStrategy"]["trainHoldoutSplit"],
        "crossValidation": quality_summary["validationStrategy"]["crossValidation"],
        "bootstrap": quality_summary["validationStrategy"]["bootstrap"],
        "bootstrapRanges": {
            "mae": quality_summary["bootstrap"]["mae"],
            "mape": quality_summary["bootstrap"]["mape"],
            "r2": quality_summary["bootstrap"]["r2"],
        },
        "missingnessNotes": [
            f"Year built or age was missing in {age_years_missing_rate * 100:.1f}% of Vancouver {property_type.lower()} listings and is median-imputed by property type when not provided."
        ],
        "locationFeatures": f"{bundle.location_feature_version} with {bundle.cluster_count} Vancouver submarket clusters",
        "clusterCount": bundle.cluster_count,
    }

    return {
        "modelVersion": bundle.model_version,
        "trainingMode": bundle.training_mode,
        "modelFamily": bundle.model_families[property_type],
        "modelScope": property_type,
        "baseValue": base_value,
        "confidenceLow": confidence_low,
        "confidenceHigh": confidence_high,
        "anchorValue": anchor_value,
        "pricePerSqft": price_per_sqft,
        "confidenceRatio": round(confidence_ratio, 4),
        "modelQuality": {
            "trainingRows": int(quality_summary["trainingRows"]),
            "cvMae": round(float(quality_summary["cv"]["maeMean"])),
            "cvMape": float(quality_summary["cv"]["mapeMean"]),
            "cvR2": float(quality_summary["cv"]["r2Mean"]),
            "holdoutMae": round(float(quality_summary["holdout"]["mae"])),
            "holdoutMape": float(quality_summary["holdout"]["mape"]),
            "holdoutR2": float(quality_summary["holdout"]["r2"]),
            "outlierRemovedRate": float(quality_summary["outlierRemovedRate"]),
            "validationSummary": validation_summary,
        },
        "drivers": _driver_candidates(property_data, bundle, local_stats, market_multiplier),
        "marketContext": {
            "localAreaLabel": local_area_label,
            "localAreaScope": local_scope,
            "localMedianValue": round(local_stats["medianPrice"] * market_multiplier),
            "localMedianPricePerSqft": round(local_stats["medianPricePerSqft"] * market_multiplier, 2),
            "vancouverMedianValue": round(bundle.city_stats["medianPrice"] * market_multiplier),
            "vancouverMedianPricePerSqft": round(bundle.city_stats["medianPricePerSqft"] * market_multiplier, 2),
            "percentileRank": round(percentile_rank, 1),
            "practicalCeiling": practical_ceiling,
            "premiumGap": round(base_value - local_stats["medianPrice"] * market_multiplier),
            "comparableCount": int(local_stats["count"]),
        },
        "marketFreshness": market_freshness,
    }


def health_payload() -> dict[str, Any]:
    bundle = load_bundle()
    return {
        "ok": True,
        "service": "model-service",
        "modelVersion": bundle.model_version,
        "trainingMode": bundle.training_mode,
        "dataPath": bundle.data_path,
        "trainedAt": bundle.trained_at,
        "rowCounts": bundle.row_counts,
        "trainingDateRange": bundle.training_date_range,
        "marketIndexPath": bundle.market_index_path,
        "modelFamilies": bundle.model_families,
        "perTypeCandidateMetrics": bundle.candidate_metrics,
        "overallWeightedMetrics": bundle.evaluation_summary["overallWeightedMetrics"],
        "evaluationSummary": bundle.evaluation_summary,
        "locationFeatureVersion": bundle.location_feature_version,
        "clusterCount": bundle.cluster_count,
        "xgboostAvailable": bundle.xgboost_available,
        "xgboostImportError": bundle.xgboost_import_error,
    }
