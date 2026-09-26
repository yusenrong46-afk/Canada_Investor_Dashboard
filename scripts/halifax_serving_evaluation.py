"""Corrected Halifax evaluation. Does not train or replace the shipped bundle.

The shipped Halifax pickle still uses the extract's full-sample time adjustment
and can train on assessed value, which inference then nulls. This module
measures a separate protocol:

- target rebuilt from salePrice with a price index fit only on pre-holdout sales
- last holdout months scored once, never used to fit the index or the baselines
- an earlier slice used only to set a residual interval; coverage is scored on
  the holdout
- features are the ones a serving request can know, so assessed value is absent
- baselines are a per-type median and a Ridge regression

Nothing here writes a pickle or changes the selected data release.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from scripts.http_fetch import write_bytes_atomically


SERVING_NUMERIC = (
    "livingAreaSqft",
    "bedrooms",
    "bathrooms",
    "latitude",
    "longitude",
    "lat_x_lon",
    "lat_sq",
    "lon_sq",
    "ageYears",
)
SERVING_CATEGORICAL = ("propertyType", "postalFsa")
EXCLUDED_FEATURES = (
    "assessedValue",
    "price",
    "logPrice",
    "pricePerSqft",
    "timeAdjustmentFactor",
    "submarketCluster",
    "h3Cell",
    "propertyTax",
)
INDEX_MIN_MARKET_PRICE = 100_000
CONFORMAL_QUANTILE = 0.8


def _price_index(dates: pd.Series, prices: pd.Series) -> pd.Series:
    frame = pd.DataFrame({"sale_date": dates, "sale_price": prices})
    market = frame[frame["sale_price"] >= INDEX_MIN_MARKET_PRICE]
    if market.empty:
        return pd.Series(dtype=float)
    months = market["sale_date"].dt.to_period("M")
    monthly = market.groupby(months)["sale_price"].median().sort_index()
    return monthly.rolling(window=3, min_periods=1, center=True).median()


def _adjustment_factors(dates: pd.Series, index: pd.Series) -> pd.Series:
    if index.empty:
        return pd.Series(1.0, index=dates.index, dtype=float)
    baseline = index.index.max()
    baseline_value = float(index.loc[baseline])
    months = dates.dt.to_period("M")

    def one(month: pd.Period) -> float:
        if month in index.index and float(index.loc[month]) > 0:
            return baseline_value / float(index.loc[month])
        return 1.0

    factors = months.map(one).astype(float)
    return factors.clip(lower=0.5, upper=2.0)


def _metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | int]:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    return {
        "rows": int(len(actual)),
        "mae": float(np.mean(np.abs(actual - predicted))),
        "mape": float(np.mean(np.abs((actual - predicted) / actual))),
    }


def _prepare(frame: pd.DataFrame) -> pd.DataFrame:
    required = ["salePrice", "saleDate", "propertyType", "livingAreaSqft", "bathrooms", "latitude", "longitude"]
    missing = [column for column in required if column not in frame.columns]
    if missing:
        raise ValueError(f"Serving evaluation needs columns {missing}.")
    prepared = frame.copy()
    prepared["salePrice"] = pd.to_numeric(prepared["salePrice"], errors="coerce")
    prepared["saleDate"] = pd.to_datetime(prepared["saleDate"], errors="coerce")
    for column in ("livingAreaSqft", "bedrooms", "bathrooms", "latitude", "longitude", "ageYears"):
        if column not in prepared.columns:
            prepared[column] = np.nan
        prepared[column] = pd.to_numeric(prepared[column], errors="coerce")
    prepared = prepared[prepared["salePrice"] > 0].copy()
    prepared = prepared[prepared["saleDate"].notna()].copy()
    prepared = prepared[prepared[["livingAreaSqft", "bathrooms", "latitude", "longitude"]].notna().all(axis=1)].copy()
    prepared["lat_x_lon"] = prepared["latitude"] * prepared["longitude"]
    prepared["lat_sq"] = prepared["latitude"] ** 2
    prepared["lon_sq"] = prepared["longitude"] ** 2
    if "postalFsa" not in prepared.columns:
        prepared["postalFsa"] = "missing"
    prepared["postalFsa"] = prepared["postalFsa"].fillna("missing").astype(str)
    prepared["propertyType"] = prepared["propertyType"].fillna("missing").astype(str)
    if prepared.empty:
        raise ValueError("Serving evaluation has no rows with sale price, sale date, and location.")
    return prepared


def _split(prepared: pd.DataFrame, holdout_months: int, calibration_months: int) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    # Start the holdout on the first day of a month so a calendar month cannot
    # sit in both the index and the test slice.
    latest_month = prepared["saleDate"].dt.to_period("M").max()
    test_start = (latest_month - (holdout_months - 1)).to_timestamp()
    calibration_start = (latest_month - (holdout_months - 1) - calibration_months).to_timestamp()
    test = prepared[prepared["saleDate"] >= test_start].copy()
    calibration = prepared[(prepared["saleDate"] >= calibration_start) & (prepared["saleDate"] < test_start)].copy()
    train = prepared[prepared["saleDate"] < calibration_start].copy()
    if len(train) < 30 or len(calibration) < 10 or len(test) < 10:
        raise ValueError(
            "Serving evaluation needs a temporal train, calibration, and test split. "
            f"Got train={len(train)}, calibration={len(calibration)}, test={len(test)}."
        )
    return train, calibration, test


def _ridge() -> Pipeline:
    numeric = list(SERVING_NUMERIC)
    categorical = list(SERVING_CATEGORICAL)
    if "assessedValue" in numeric or "assessedValue" in categorical:
        raise RuntimeError("assessedValue is not a serving-compatible feature.")
    preprocess = ColumnTransformer(
        [
            ("numeric", SimpleImputer(strategy="median"), numeric),
            (
                "categorical",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
                    ]
                ),
                categorical,
            ),
        ]
    )
    return Pipeline([("prepare", preprocess), ("model", Ridge(alpha=1.0))])


def evaluate_serving_compatible(
    frame: pd.DataFrame,
    *,
    holdout_months: int = 6,
    calibration_months: int = 6,
) -> dict[str, Any]:
    """Score median and Ridge baselines. Does not fit or save the shipped model."""
    prepared = _prepare(frame)
    train, calibration, test = _split(prepared, holdout_months, calibration_months)
    pre_holdout = pd.concat([train, calibration], ignore_index=True)
    index = _price_index(pre_holdout["saleDate"], pre_holdout["salePrice"])
    for part in (train, calibration, test):
        part["adjustedSalePrice"] = part["salePrice"] * _adjustment_factors(part["saleDate"], index)

    features = list(SERVING_NUMERIC + SERVING_CATEGORICAL)
    type_median = train.groupby("propertyType")["adjustedSalePrice"].median()
    global_median = float(train["adjustedSalePrice"].median())
    median_test = test["propertyType"].map(type_median).fillna(global_median).to_numpy(dtype=float)

    model = _ridge()
    model.fit(train[features], np.log(train["adjustedSalePrice"].to_numpy(dtype=float)))
    ridge_calibration = np.exp(model.predict(calibration[features]))
    ridge_test = np.exp(model.predict(test[features]))
    residual_quantile = float(
        np.quantile(np.abs(calibration["adjustedSalePrice"].to_numpy(dtype=float) - ridge_calibration), CONFORMAL_QUANTILE)
    )
    test_actual = test["adjustedSalePrice"].to_numpy(dtype=float)
    covered = np.abs(test_actual - ridge_test) <= residual_quantile

    test_months = set(test["saleDate"].dt.to_period("M"))
    index_months = set(index.index)
    overlap = sorted(str(month) for month in test_months & index_months)
    return {
        "protocol": "serving_compatible_temporal",
        "promotedModel": False,
        "replacesShippedBundle": False,
        "features": features,
        "excludedFeatures": list(EXCLUDED_FEATURES),
        "assessedValueUsed": False,
        "timeAdjustment": {
            "fitOn": "pre_holdout_sales_only",
            "baselineMonth": str(index.index.max()) if len(index) else None,
            "indexMonthCount": int(len(index)),
            "holdoutMonthsInIndex": overlap,
        },
        "splits": {
            "holdoutMonths": holdout_months,
            "calibrationMonths": calibration_months,
            "trainRows": int(len(train)),
            "calibrationRows": int(len(calibration)),
            "testRows": int(len(test)),
            "trainEndExclusive": str(train["saleDate"].max().date()) if len(train) else None,
            "testStart": str(test["saleDate"].min().date()) if len(test) else None,
            "disjoint": True,
        },
        "baselines": {
            "median": _metrics(test_actual, median_test),
            "ridge": _metrics(test_actual, ridge_test),
        },
        "calibration": {
            "independentOfTest": True,
            "method": "absolute residual quantile of the Ridge baseline on the calibration slice; coverage is measured on the test slice",
            "quantile": CONFORMAL_QUANTILE,
            "absoluteResidual": residual_quantile,
            "testCoverage": float(covered.mean()),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Score Halifax median and Ridge baselines without promoting a model.")
    parser.add_argument(
        "--data",
        default=str(Path(__file__).resolve().parents[1] / "data" / "processed" / "halifax_base_model_training.csv"),
    )
    parser.add_argument("--output", default=None, help="Optional JSON path. Omit to print the result.")
    args = parser.parse_args()
    frame = pd.read_csv(args.data, low_memory=False)
    result = evaluate_serving_compatible(frame)
    payload = (json.dumps(result, indent=2) + "\n").encode("utf-8")
    if args.output:
        write_bytes_atomically(Path(args.output), payload)
    else:
        sys.stdout.buffer.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
