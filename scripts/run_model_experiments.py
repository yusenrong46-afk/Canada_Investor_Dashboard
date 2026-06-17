from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WAREHOUSE_PATH = REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb"
DEFAULT_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "model_experiments.json"
DEFAULT_REPORT_PATH = REPO_ROOT / "reports" / "model_experiments_report.md"

# Optional MLflow tracking: the lab's primary outputs (DuckDB/JSON/MD) never depend on it.
# The helper lives under the model service; make it importable without hard-coupling.
import sys

_MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
if str(_MODEL_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_MODEL_SERVICE_DIR))
try:
    from common import mlflow_tracking
except Exception:  # pragma: no cover - MLflow helper is strictly optional
    mlflow_tracking = None

EXPERIMENTS = ("local", "pooled", "hybrid")
TARGET_COLUMN = "log_target_value"
NUMERIC_FEATURES = [
    "living_area_sqft",
    "bedrooms",
    "bathrooms",
    "age_years",
    "latitude",
    "longitude",
    "lat_x_lon",
    "lat_sq",
    "lon_sq",
]
LOCAL_CATEGORICAL_FEATURES = ["postal_fsa", "submarket_cluster", "property_type"]
# The pooled model additionally sees which market a row came from.
POOLED_CATEGORICAL_FEATURES = LOCAL_CATEGORICAL_FEATURES + ["market_id", "province_state"]

RANDOM_STATE = 42
HOLDOUT_FRACTION = 0.2
# Below this many holdout rows a property-type slice is skipped, not scored.
MIN_SLICE_HOLDOUT_ROWS = 30
MAX_SPATIAL_FOLDS = 5

TARGET_SEMANTICS_CAVEAT = (
    "Caveat: the two markets have different target semantics (Vancouver models listing price; "
    "Halifax/Maritimes models time-adjusted sale price). Pooling tests whether cross-market "
    "structure transfers despite that difference, not that the targets are interchangeable."
)


def _import_duckdb():
    try:
        import duckdb  # type: ignore[import-not-found]
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "DuckDB is required for the model experiment lab. Install it with `.venv/bin/pip install duckdb`."
        ) from exc
    return duckdb


def detect_model_family() -> str:
    try:
        import xgboost  # type: ignore[import-not-found]  # noqa: F401

        return "xgboost"
    except ModuleNotFoundError:
        return "random_forest"


def _make_model(family: str, *, depth_limited: bool = False):
    if family == "xgboost":
        from xgboost import XGBRegressor  # type: ignore[import-not-found]

        return XGBRegressor(
            n_estimators=150 if depth_limited else 400,
            max_depth=3 if depth_limited else 6,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            tree_method="hist",
            random_state=RANDOM_STATE,
            n_jobs=4,
        )

    from sklearn.ensemble import RandomForestRegressor

    return RandomForestRegressor(
        n_estimators=300,
        max_depth=4 if depth_limited else None,
        min_samples_leaf=2,
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )


def _make_pipeline(family: str, categorical_features: list[str], *, depth_limited: bool = False):
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    preprocessor = ColumnTransformer(
        [
            # keep_empty_features: Vancouver has no age_years, so the local
            # Vancouver model sees an all-missing column that must not vanish.
            ("numeric", SimpleImputer(strategy="median", keep_empty_features=True), NUMERIC_FEATURES),
            ("categorical", OneHotEncoder(handle_unknown="ignore"), categorical_features),
        ]
    )
    return Pipeline([("preprocess", preprocessor), ("model", _make_model(family, depth_limited=depth_limited))])


def _load_mart(warehouse_path: Path) -> tuple[pd.DataFrame, dict[str, str]]:
    duckdb = _import_duckdb()
    if not warehouse_path.exists():
        raise FileNotFoundError(
            f"Missing analytics warehouse: {warehouse_path}. Run scripts/build_property_warehouse.py first."
        )

    columns = (
        ["property_observation_id", "market_id", "province_state", "target_name", TARGET_COLUMN]
        + NUMERIC_FEATURES
        + LOCAL_CATEGORICAL_FEATURES
    )
    connection = duckdb.connect(str(warehouse_path), read_only=True)
    try:
        frame = connection.execute(
            f"SELECT {', '.join(columns)} FROM fact_property_training_mart "
            "WHERE is_model_ready ORDER BY market_id, property_observation_id"
        ).fetchdf()
    finally:
        connection.close()

    if frame.empty:
        raise ValueError(f"fact_property_training_mart has no model-ready rows in {warehouse_path}.")

    for column in LOCAL_CATEGORICAL_FEATURES + ["market_id", "province_state"]:
        frame[column] = frame[column].fillna("missing").astype(str)

    target_names = {
        market_id: "/".join(sorted(group["target_name"].dropna().unique()))
        for market_id, group in frame.groupby("market_id")
    }
    return frame, target_names


def _market_splits(frame: pd.DataFrame) -> dict[str, tuple[pd.DataFrame, pd.DataFrame]]:
    """One deterministic 80/20 holdout per market, reused by every experiment."""
    from sklearn.model_selection import train_test_split

    splits: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {}
    for market_id, market_frame in frame.groupby("market_id"):
        ordered = market_frame.sort_values("property_observation_id").reset_index(drop=True)
        train_frame, holdout_frame = train_test_split(ordered, test_size=HOLDOUT_FRACTION, random_state=RANDOM_STATE)
        splits[str(market_id)] = (train_frame.reset_index(drop=True), holdout_frame.reset_index(drop=True))
    return splits


def _price_space_metrics(log_true: np.ndarray, log_pred: np.ndarray) -> tuple[float, float]:
    true_price = np.expm1(np.asarray(log_true, dtype=float))
    pred_price = np.expm1(np.asarray(log_pred, dtype=float))
    abs_error = np.abs(pred_price - true_price)
    mae = float(abs_error.mean())
    # MAPE as a fraction (0.18 = 18%) to match the shared contract consumed by the UI.
    mape = float((abs_error / true_price).mean())
    return mae, mape


def _spatial_cv_maes(
    family: str, splits: dict[str, tuple[pd.DataFrame, pd.DataFrame]]
) -> dict[tuple[str, str], float | None]:
    """Leave-FSA-groups-out MAE on the training split only, per experiment."""
    from sklearn.model_selection import GroupKFold

    results: dict[tuple[str, str], float | None] = {}
    for market, (train_frame, _) in splits.items():
        other_frames = [other_train for other, (other_train, _) in splits.items() if other != market]
        other_train = pd.concat(other_frames, ignore_index=True) if other_frames else None

        groups = train_frame["postal_fsa"]
        n_splits = min(MAX_SPATIAL_FOLDS, int(groups.nunique()))
        if n_splits < 2:
            for experiment in EXPERIMENTS:
                results[(experiment, market)] = None
            continue

        abs_errors: dict[str, list[np.ndarray]] = {experiment: [] for experiment in EXPERIMENTS}
        for fold_train_idx, fold_test_idx in GroupKFold(n_splits=n_splits).split(train_frame, groups=groups):
            fold_train = train_frame.iloc[fold_train_idx]
            fold_test = train_frame.iloc[fold_test_idx]
            true_price = np.expm1(fold_test[TARGET_COLUMN].to_numpy(dtype=float))

            local_pipeline = _make_pipeline(family, LOCAL_CATEGORICAL_FEATURES)
            local_pipeline.fit(fold_train, fold_train[TARGET_COLUMN])
            local_price = np.expm1(np.asarray(local_pipeline.predict(fold_test), dtype=float))
            abs_errors["local"].append(np.abs(local_price - true_price))

            pooled_fold_train = (
                pd.concat([other_train, fold_train], ignore_index=True) if other_train is not None else fold_train
            )
            pooled_pipeline = _make_pipeline(family, POOLED_CATEGORICAL_FEATURES)
            pooled_pipeline.fit(pooled_fold_train, pooled_fold_train[TARGET_COLUMN])
            pooled_log = np.asarray(pooled_pipeline.predict(fold_test), dtype=float)
            abs_errors["pooled"].append(np.abs(np.expm1(pooled_log) - true_price))

            residuals = fold_train[TARGET_COLUMN].to_numpy(dtype=float) - np.asarray(
                pooled_pipeline.predict(fold_train), dtype=float
            )
            residual_pipeline = _make_pipeline(family, LOCAL_CATEGORICAL_FEATURES, depth_limited=True)
            residual_pipeline.fit(fold_train, residuals)
            hybrid_log = pooled_log + np.asarray(residual_pipeline.predict(fold_test), dtype=float)
            abs_errors["hybrid"].append(np.abs(np.expm1(hybrid_log) - true_price))

        for experiment in EXPERIMENTS:
            results[(experiment, market)] = float(np.concatenate(abs_errors[experiment]).mean())
    return results


def _fit_experiments(
    family: str, splits: dict[str, tuple[pd.DataFrame, pd.DataFrame]]
) -> tuple[dict[tuple[str, str], np.ndarray], dict[tuple[str, str], int], pd.DataFrame]:
    markets = sorted(splits)
    pooled_train = pd.concat([splits[market][0] for market in markets], ignore_index=True)

    predictions: dict[tuple[str, str], np.ndarray] = {}
    training_rows: dict[tuple[str, str], int] = {}

    for market in markets:
        train_frame, holdout_frame = splits[market]
        local_pipeline = _make_pipeline(family, LOCAL_CATEGORICAL_FEATURES)
        local_pipeline.fit(train_frame, train_frame[TARGET_COLUMN])
        predictions[("local", market)] = np.asarray(local_pipeline.predict(holdout_frame), dtype=float)
        training_rows[("local", market)] = len(train_frame)

    pooled_pipeline = _make_pipeline(family, POOLED_CATEGORICAL_FEATURES)
    pooled_pipeline.fit(pooled_train, pooled_train[TARGET_COLUMN])
    for market in markets:
        train_frame, holdout_frame = splits[market]
        pooled_log = np.asarray(pooled_pipeline.predict(holdout_frame), dtype=float)
        predictions[("pooled", market)] = pooled_log
        training_rows[("pooled", market)] = len(pooled_train)

        residuals = train_frame[TARGET_COLUMN].to_numpy(dtype=float) - np.asarray(
            pooled_pipeline.predict(train_frame), dtype=float
        )
        residual_pipeline = _make_pipeline(family, LOCAL_CATEGORICAL_FEATURES, depth_limited=True)
        residual_pipeline.fit(train_frame, residuals)
        predictions[("hybrid", market)] = pooled_log + np.asarray(residual_pipeline.predict(holdout_frame), dtype=float)
        training_rows[("hybrid", market)] = len(pooled_train)

    return predictions, training_rows, pooled_train


def _skipped_slices(splits: dict[str, tuple[pd.DataFrame, pd.DataFrame]]) -> dict[str, list[tuple[str, int]]]:
    skipped: dict[str, list[tuple[str, int]]] = {}
    for market, (_, holdout_frame) in splits.items():
        counts = holdout_frame["property_type"].value_counts()
        skipped[market] = sorted(
            (str(property_type), int(count)) for property_type, count in counts.items() if count < MIN_SLICE_HOLDOUT_ROWS
        )
    return skipped


def _market_row_notes(
    experiment: str,
    market: str,
    markets: list[str],
    splits: dict[str, tuple[pd.DataFrame, pd.DataFrame]],
    skipped: dict[str, list[tuple[str, int]]],
    spatial_mae: float | None,
) -> str | None:
    train_frame, holdout_frame = splits[market]
    pieces: list[str] = []
    if experiment == "pooled":
        pieces.append(
            f"Trained on the combined training splits of {len(markets)} market(s) "
            "with market_id and province_state as features."
        )
    if experiment == "hybrid":
        pieces.append(
            f"Pooled base model plus a depth-limited residual model fit on {len(train_frame):,} {market} training rows."
        )
    if len(holdout_frame) < MIN_SLICE_HOLDOUT_ROWS:
        pieces.append("Thin holdout (< 30 rows); metrics are directional only.")
    if skipped[market]:
        skipped_text = ", ".join(f"{property_type} ({count} rows)" for property_type, count in skipped[market])
        pieces.append(f"Skipped thin property-type slices (< {MIN_SLICE_HOLDOUT_ROWS} holdout rows): {skipped_text}.")
    if spatial_mae is None:
        pieces.append("Spatial CV not run: fewer than 2 postal FSAs in the training split.")
    return " ".join(pieces) or None


def _build_rows(
    family: str,
    splits: dict[str, tuple[pd.DataFrame, pd.DataFrame]],
    predictions: dict[tuple[str, str], np.ndarray],
    training_rows: dict[tuple[str, str], int],
    pooled_train: pd.DataFrame,
    spatial: dict[tuple[str, str], float | None],
    skipped: dict[str, list[tuple[str, int]]],
) -> list[dict[str, Any]]:
    markets = sorted(splits)
    rows: list[dict[str, Any]] = []
    for experiment in EXPERIMENTS:
        for market in markets:
            train_frame, holdout_frame = splits[market]
            log_true = holdout_frame[TARGET_COLUMN].to_numpy(dtype=float)
            log_pred = predictions[(experiment, market)]
            mae, mape = _price_space_metrics(log_true, log_pred)
            spatial_mae = spatial[(experiment, market)]
            rows.append(
                {
                    "experiment": experiment,
                    "market": market,
                    "propertyType": "All",
                    "family": family,
                    "trainingRows": training_rows[(experiment, market)],
                    "holdoutRows": len(holdout_frame),
                    "holdoutMae": round(mae, 2),
                    "holdoutMape": round(mape, 4),
                    "spatialCvMae": round(spatial_mae, 2) if spatial_mae is not None else None,
                    "notes": _market_row_notes(experiment, market, markets, splits, skipped, spatial_mae),
                }
            )

            holdout_counts = holdout_frame["property_type"].value_counts()
            for property_type in sorted(holdout_counts.index):
                slice_holdout = int(holdout_counts[property_type])
                if slice_holdout < MIN_SLICE_HOLDOUT_ROWS:
                    continue
                mask = (holdout_frame["property_type"] == property_type).to_numpy()
                slice_mae, slice_mape = _price_space_metrics(log_true[mask], log_pred[mask])
                slice_training_source = train_frame if experiment == "local" else pooled_train
                slice_training = int((slice_training_source["property_type"] == property_type).sum())
                rows.append(
                    {
                        "experiment": experiment,
                        "market": market,
                        "propertyType": str(property_type),
                        "family": family,
                        "trainingRows": slice_training,
                        "holdoutRows": slice_holdout,
                        "holdoutMae": round(slice_mae, 2),
                        "holdoutMape": round(slice_mape, 4),
                        "spatialCvMae": None,
                        "notes": None
                        if experiment == "local"
                        else "Training rows count covers this property type across every pooled market.",
                    }
                )
    return rows


def _derive_conclusions(
    rows: list[dict[str, Any]],
    skipped: dict[str, list[tuple[str, int]]],
    target_names: dict[str, str],
) -> list[str]:
    conclusions = [TARGET_SEMANTICS_CAVEAT]
    market_level = [row for row in rows if row["propertyType"] == "All"]
    markets = sorted({row["market"] for row in rows})

    market_winner: dict[str, str] = {}
    for market in markets:
        ranked = sorted((row for row in market_level if row["market"] == market), key=lambda row: row["holdoutMae"])
        winner = ranked[0]
        market_winner[market] = winner["experiment"]
        runners = ", ".join(f"{row['experiment']} ${row['holdoutMae']:,.0f}" for row in ranked[1:])
        conclusions.append(
            f"{market} (target: {target_names.get(market, 'unknown')}): {winner['experiment']} wins the holdout "
            f"with MAE ${winner['holdoutMae']:,.0f} (MAPE {winner['holdoutMape']:.1%}) vs {runners}."
        )

    slice_keys = sorted({(row["market"], row["propertyType"]) for row in rows if row["propertyType"] != "All"})
    for market, property_type in slice_keys:
        slice_rows = sorted(
            (row for row in rows if row["market"] == market and row["propertyType"] == property_type),
            key=lambda row: row["holdoutMae"],
        )
        winner = slice_rows[0]
        if winner["experiment"] == market_winner[market]:
            continue
        market_best = next(row for row in slice_rows if row["experiment"] == market_winner[market])
        local_training = next(row["trainingRows"] for row in slice_rows if row["experiment"] == "local")
        conclusions.append(
            f"{market} {property_type}: {winner['experiment']} beats the market-level winner "
            f"{market_winner[market]} (MAE ${winner['holdoutMae']:,.0f} vs ${market_best['holdoutMae']:,.0f}; "
            f"the local model saw {local_training:,} training rows for this slice)."
        )

    for market in markets:
        spatial_rows = [row for row in market_level if row["market"] == market and row["spatialCvMae"] is not None]
        if not spatial_rows:
            continue
        ranked = sorted(spatial_rows, key=lambda row: row["spatialCvMae"])
        runners = ", ".join(f"{row['experiment']} ${row['spatialCvMae']:,.0f}" for row in ranked[1:])
        conclusions.append(
            f"Spatial generalization on {market} (GroupKFold by postal FSA, training split only): "
            f"{ranked[0]['experiment']} has the lowest MAE at ${ranked[0]['spatialCvMae']:,.0f} vs {runners}."
        )

    skipped_bits = [
        f"{market} {property_type} ({count} holdout rows)"
        for market in sorted(skipped)
        for property_type, count in skipped[market]
    ]
    if skipped_bits:
        conclusions.append(
            f"Slices skipped as too thin to score honestly (< {MIN_SLICE_HOLDOUT_ROWS} holdout rows): "
            + "; ".join(skipped_bits)
            + "."
        )
    return conclusions


def _write_warehouse_table(warehouse_path: Path, rows: list[dict[str, Any]], run_at: datetime) -> None:
    duckdb = _import_duckdb()
    table_frame = pd.DataFrame(
        [
            {
                "experiment": row["experiment"],
                "market": row["market"],
                "property_type": row["propertyType"],
                "family": row["family"],
                "training_rows": row["trainingRows"],
                "holdout_rows": row["holdoutRows"],
                "holdout_mae": row["holdoutMae"],
                "holdout_mape": row["holdoutMape"],
                "spatial_cv_mae": np.nan if row["spatialCvMae"] is None else row["spatialCvMae"],
                "notes": row["notes"],
                "run_at": pd.Timestamp(run_at),
            }
            for row in rows
        ]
    )
    connection = duckdb.connect(str(warehouse_path))
    try:
        connection.register("model_experiments_source", table_frame)
        connection.execute("CREATE OR REPLACE TABLE fact_model_experiments AS SELECT * FROM model_experiments_source")
    finally:
        connection.close()


def _format_optional_mae(value: float | None) -> str:
    return f"${value:,.0f}" if value is not None else "not run"


def _write_report(
    report_path: Path,
    payload: dict[str, Any],
    target_names: dict[str, str],
    family: str,
    skipped: dict[str, list[tuple[str, int]]],
    warehouse_path: Path,
) -> None:
    rows = payload["rows"]
    markets = sorted({row["market"] for row in rows})
    lines = [
        "# Model Experiment Lab Report",
        "",
        f"Generated: {payload['generatedAt']}",
        "",
        f"Warehouse: `{warehouse_path}`",
        "",
        f"Model family: `{family}` (the same family is used by every experiment so the comparison is fair).",
        "",
        "## Protocol",
        "",
        f"- Shared features: {', '.join(NUMERIC_FEATURES)} (numeric, median-imputed) + "
        f"{', '.join(LOCAL_CATEGORICAL_FEATURES)} (categorical); the pooled and hybrid stages add "
        "market_id and province_state.",
        f"- Target: `{TARGET_COLUMN}`; MAE/MAPE are computed in price space via expm1.",
        f"- One deterministic 80/20 holdout split per market (random_state {RANDOM_STATE}), reused by every experiment.",
        f"- Spatial check: GroupKFold by postal FSA (n_splits = min({MAX_SPATIAL_FOLDS}, FSAs)) on the training split only.",
        "- The hybrid residual stage fits on in-sample pooled residuals; the spatial CV is the out-of-sample check.",
        f"- Property-type slices with < {MIN_SLICE_HOLDOUT_ROWS} holdout rows are skipped, not reported as signal.",
        "",
        "## Market Leaderboards (holdout)",
    ]

    for market in markets:
        market_rows = sorted(
            (row for row in rows if row["market"] == market and row["propertyType"] == "All"),
            key=lambda row: row["holdoutMae"],
        )
        lines.extend(
            [
                "",
                f"### {market} — target: {target_names.get(market, 'unknown')}",
                "",
                "| Experiment | Training rows | Holdout rows | MAE | MAPE | Spatial CV MAE |",
                "|---|---:|---:|---:|---:|---:|",
            ]
        )
        for row in market_rows:
            lines.append(
                f"| {row['experiment']} | {row['trainingRows']:,} | {row['holdoutRows']:,} "
                f"| ${row['holdoutMae']:,.0f} | {row['holdoutMape']:.1%} "
                f"| {_format_optional_mae(row['spatialCvMae'])} |"
            )

    slice_rows = [row for row in rows if row["propertyType"] != "All"]
    lines.extend(["", "## Property-Type Slices (holdout)", ""])
    if slice_rows:
        lines.extend(
            [
                "| Market | Property type | Experiment | Training rows | Holdout rows | MAE | MAPE |",
                "|---|---|---|---:|---:|---:|---:|",
            ]
        )
        for row in sorted(slice_rows, key=lambda row: (row["market"], row["propertyType"], row["holdoutMae"])):
            lines.append(
                f"| {row['market']} | {row['propertyType']} | {row['experiment']} | {row['trainingRows']:,} "
                f"| {row['holdoutRows']:,} | ${row['holdoutMae']:,.0f} | {row['holdoutMape']:.1%} |"
            )
    else:
        lines.append(f"No property-type slice reached {MIN_SLICE_HOLDOUT_ROWS} holdout rows; none were scored.")

    skipped_bits = [
        f"- {market} {property_type}: {count} holdout rows"
        for market in sorted(skipped)
        for property_type, count in skipped[market]
    ]
    lines.extend(["", "## Skipped Slices", ""])
    lines.extend(skipped_bits or ["- none"])

    lines.extend(["", "## Conclusions", ""])
    lines.extend(f"- {conclusion}" for conclusion in payload["conclusions"])
    lines.append("")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines))


def _log_experiments_to_mlflow(
    rows: list[dict[str, Any]],
    family: str,
    run_at: datetime,
    target_names: dict[str, str],
    conclusions: list[str],
) -> None:
    """Log each (architecture x market) as a nested MLflow run so the lab keeps a longitudinal
    history (the DuckDB table is overwritten every run). Purely additive — never raises into
    the lab's primary outputs."""
    if mlflow_tracking is None or not mlflow_tracking.available():
        return
    try:
        mlflow_tracking.configure(mlflow_tracking.EXPERIMENT_LAB)
        all_rows = [row for row in rows if row["propertyType"] == "All"]
        markets = sorted({row["market"] for row in all_rows})
        winners = {
            market: min(
                (row for row in all_rows if row["market"] == market),
                key=lambda row: row["holdoutMae"],
            )["experiment"]
            for market in markets
        }
        run_stamp = run_at.strftime("%Y%m%dT%H%M%SZ")
        sha7 = mlflow_tracking.common_tags().get("git_sha7", "nogit")
        parent_name = f"lab/{sha7}/{run_stamp}"
        with mlflow_tracking.start_run(
            run_name=parent_name,
            tags=mlflow_tracking.common_tags({"experiment_family": "lab", "family": family}),
        ):
            mlflow_tracking.set_tags(
                {"target_semantics_caveat": TARGET_SEMANTICS_CAVEAT, "markets": ",".join(markets)}
            )
            mlflow_tracking.log_dict_artifact({"conclusions": conclusions}, "conclusions.json")
            slice_rows = [row for row in rows if row["propertyType"] != "All"]
            if slice_rows:
                mlflow_tracking.log_dict_artifact({"slices": slice_rows}, "slices.json")
            for row in all_rows:
                is_pooled = row["experiment"] in ("pooled", "hybrid")
                categorical = POOLED_CATEGORICAL_FEATURES if is_pooled else LOCAL_CATEGORICAL_FEATURES
                child_tags = mlflow_tracking.common_tags(
                    {
                        "experiment_family": "lab",
                        "market": row["market"],
                        "architecture": row["experiment"],
                        "is_market_winner": "true" if winners.get(row["market"]) == row["experiment"] else "false",
                    }
                )
                with mlflow_tracking.start_run(
                    run_name=f"{row['experiment']}-{row['market']}",
                    nested=True,
                    tags=child_tags,
                ):
                    mlflow_tracking.log_params(
                        {
                            "architecture": row["experiment"],
                            "market": row["market"],
                            "family": row["family"],
                            "target_column": TARGET_COLUMN,
                            "target_name": target_names.get(row["market"]),
                            "numeric_features": ",".join(NUMERIC_FEATURES),
                            "categorical_features": ",".join(categorical),
                            "holdout_fraction": HOLDOUT_FRACTION,
                            "random_state": RANDOM_STATE,
                            "max_spatial_folds": MAX_SPATIAL_FOLDS,
                            "n_train": row["trainingRows"],
                            "n_holdout": row["holdoutRows"],
                        }
                    )
                    mlflow_tracking.log_metrics(
                        {
                            "holdout_mae": row["holdoutMae"],
                            "holdout_mape": row["holdoutMape"],
                            "spatial_cv_mae": row["spatialCvMae"],
                        }
                    )
    except Exception as exc:  # pragma: no cover - logging must never break the lab
        print(f"MLflow logging skipped: {exc}")


def run_model_experiments(
    *,
    warehouse_path: Path = DEFAULT_WAREHOUSE_PATH,
    export_path: Path = DEFAULT_EXPORT_PATH,
    report_path: Path = DEFAULT_REPORT_PATH,
) -> dict[str, Any]:
    """Compare local, pooled, and hybrid valuation models on the shared mart
    under one protocol, and persist the leaderboard to the warehouse, the
    dashboard export, and a markdown report."""
    frame, target_names = _load_mart(warehouse_path)
    family = detect_model_family()
    splits = _market_splits(frame)

    predictions, training_rows, pooled_train = _fit_experiments(family, splits)
    spatial = _spatial_cv_maes(family, splits)
    skipped = _skipped_slices(splits)
    rows = _build_rows(family, splits, predictions, training_rows, pooled_train, spatial, skipped)
    conclusions = _derive_conclusions(rows, skipped, target_names)

    run_at = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "status": "ready",
        "generatedAt": run_at.isoformat(),
        "source": (
            "fact_property_training_mart (DuckDB analytics warehouse); shared-protocol local vs pooled vs hybrid "
            f"experiments ({family}); per-market 80/20 holdout (random_state {RANDOM_STATE}); spatial GroupKFold "
            "by postal FSA on training splits; MAE/MAPE in price space, MAPE as a fraction"
        ),
        # notes is optional (not nullable) in the shared contract, so None entries are omitted.
        "rows": [{key: value for key, value in row.items() if not (key == "notes" and value is None)} for row in rows],
        "conclusions": conclusions,
    }

    _write_warehouse_table(warehouse_path, rows, run_at)
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_text(json.dumps(payload) + "\n")
    _write_report(report_path, payload, target_names, family, skipped, warehouse_path)
    _log_experiments_to_mlflow(rows, family, run_at, target_names, conclusions)

    print(f"Wrote {len(rows)} experiment rows to fact_model_experiments in {warehouse_path}")
    print(f"Wrote {export_path}")
    print(f"Wrote {report_path}")
    return payload


if __name__ == "__main__":
    experiment_payload = run_model_experiments()
    for experiment_row in experiment_payload["rows"]:
        if experiment_row["propertyType"] != "All":
            continue
        print(
            f"{experiment_row['market']} {experiment_row['experiment']}: "
            f"MAE ${experiment_row['holdoutMae']:,.0f}, MAPE {experiment_row['holdoutMape']:.1%}, "
            f"spatial CV MAE {_format_optional_mae(experiment_row['spatialCvMae'])}"
        )
