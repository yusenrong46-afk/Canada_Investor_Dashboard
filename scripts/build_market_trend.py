from __future__ import annotations

import argparse
import json
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from statsmodels.tsa.exponential_smoothing.ets import ETSModel


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw" / "market"
DEFAULT_CSV_PATH = DEFAULT_RAW_DIR / "18100205.csv"
DEFAULT_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "market_trend.json"
DEFAULT_WAREHOUSE_PATH = REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb"

STATCAN_ZIP_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/18100205-eng.zip"
STATCAN_CSV_NAME = "18100205.csv"
NHPI_COMPONENT = "Total (house and land)"
REQUIRED_NHPI_COLUMNS = ["REF_DATE", "GEO", "New housing price indexes", "VALUE"]

HISTORY_START = "2005-01"
EXPORT_HISTORY_MONTHS = 120
FORECAST_HORIZON = 12
BACKTEST_HORIZON = 12
SEASONAL_PERIODS = 12
# An additive-seasonal model must beat the best non-seasonal AIC by this margin
# before its 12 extra seasonal states are accepted.
SEASONAL_AIC_MARGIN = 10.0
PREDICTION_INTERVAL_ALPHA = 0.2

MARKETS = [
    {"market_id": "vancouver", "label": "Vancouver", "geo": "Vancouver, British Columbia"},
    {"market_id": "halifax_maritimes", "label": "Halifax / Maritimes", "geo": "Halifax, Nova Scotia"},
]

DATA_SOURCE_NOTE = (
    "Statistics Canada New Housing Price Index (table 18-10-0205-01), NHPI, new housing only "
    "— used as a market direction proxy, not a resale price level"
)


@dataclass(frozen=True)
class MarketTrendBuildSummary:
    export_path: Path
    market_rows: dict
    last_observed: dict
    backtest_mape: dict
    warehouse_table_written: bool


def download_statcan_table(raw_dir: Path = DEFAULT_RAW_DIR) -> Path:
    raw_dir.mkdir(parents=True, exist_ok=True)
    zip_path = raw_dir / "18100205-eng.zip"
    print(f"Downloading {STATCAN_ZIP_URL} ...")
    urllib.request.urlretrieve(STATCAN_ZIP_URL, zip_path)
    with zipfile.ZipFile(zip_path) as archive:
        archive.extract(STATCAN_CSV_NAME, raw_dir)
    return raw_dir / STATCAN_CSV_NAME


def _read_nhpi_csv(csv_path: Path) -> pd.DataFrame:
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Missing NHPI CSV: {csv_path}. Download Statistics Canada table 18-10-0205-01 from "
            f"{STATCAN_ZIP_URL} (or run this script with --download). No data will be fabricated."
        )

    frame = pd.read_csv(csv_path)
    missing_columns = [column for column in REQUIRED_NHPI_COLUMNS if column not in frame.columns]
    if missing_columns:
        raise ValueError(f"NHPI CSV is missing required columns: {', '.join(missing_columns)}")
    return frame


def _market_series(frame: pd.DataFrame, geo: str) -> pd.Series:
    rows = frame[
        (frame["New housing price indexes"] == NHPI_COMPONENT)
        & (frame["GEO"] == geo)
        & (frame["REF_DATE"] >= HISTORY_START)
    ][["REF_DATE", "VALUE"]].dropna(subset=["VALUE"])
    if rows.empty:
        raise ValueError(f"No '{NHPI_COMPONENT}' rows for GEO '{geo}' from {HISTORY_START} onward in the NHPI CSV.")

    index = pd.PeriodIndex(rows["REF_DATE"], freq="M").to_timestamp()
    series = pd.Series(rows["VALUE"].astype(float).to_numpy(), index=index).sort_index()
    if series.index.duplicated().any():
        raise ValueError(f"Duplicate monthly observations for GEO '{geo}' in the NHPI CSV.")

    missing_months = pd.date_range(series.index[0], series.index[-1], freq="MS").difference(series.index)
    if len(missing_months):
        gaps = ", ".join(stamp.strftime("%Y-%m") for stamp in missing_months[:6])
        raise ValueError(f"NHPI series for GEO '{geo}' is missing months ({gaps}, ...); refusing to interpolate.")
    return series.asfreq("MS")


def _fit_spec(series: pd.Series, spec: dict) -> Any:
    kwargs = {"error": "add", "trend": "add", "damped_trend": spec["damped_trend"]}
    if spec["seasonal"]:
        kwargs["seasonal"] = "add"
        kwargs["seasonal_periods"] = SEASONAL_PERIODS
    return ETSModel(series, **kwargs).fit(disp=False)


def _select_ets_fit(series: pd.Series) -> tuple:
    specs = [{"damped_trend": damped, "seasonal": False} for damped in (False, True)]
    if len(series) >= 2 * SEASONAL_PERIODS:
        specs.extend({"damped_trend": damped, "seasonal": True} for damped in (False, True))

    fits = [(spec, _fit_spec(series, spec)) for spec in specs]
    best_nonseasonal = min((item for item in fits if not item[0]["seasonal"]), key=lambda item: item[1].aic)
    seasonal_fits = [item for item in fits if item[0]["seasonal"]]
    if seasonal_fits:
        best_seasonal = min(seasonal_fits, key=lambda item: item[1].aic)
        if best_seasonal[1].aic < best_nonseasonal[1].aic - SEASONAL_AIC_MARGIN:
            return best_seasonal
    return best_nonseasonal


def _method_label(spec: dict) -> str:
    trend_code = "Ad" if spec["damped_trend"] else "A"
    seasonal_code = "A" if spec["seasonal"] else "N"
    return f"ETS(A,{trend_code},{seasonal_code}) exponential smoothing, 80% prediction interval"


def _forecast_frame(fit: Any, series: pd.Series) -> pd.DataFrame:
    horizon = pd.date_range(series.index[-1], periods=FORECAST_HORIZON + 1, freq="MS")[1:]
    prediction = fit.get_prediction(start=horizon[0], end=horizon[-1])
    return prediction.summary_frame(alpha=PREDICTION_INTERVAL_ALPHA)


def _backtest_mape(series: pd.Series, spec: dict) -> float:
    train = series.iloc[:-BACKTEST_HORIZON]
    actual = series.iloc[-BACKTEST_HORIZON:]
    fit = _fit_spec(train, spec)
    predicted = fit.get_prediction(start=actual.index[0], end=actual.index[-1]).predicted_mean
    return float(((actual - predicted).abs() / actual).mean() * 100)


def _points(history: pd.Series, forecast_frame: pd.DataFrame) -> list:
    points = [
        {
            "period": stamp.strftime("%Y-%m"),
            "indexValue": float(value),
            "forecastValue": None,
            "forecastLow": None,
            "forecastHigh": None,
        }
        for stamp, value in history.items()
    ]
    for stamp, row in forecast_frame.iterrows():
        points.append(
            {
                "period": stamp.strftime("%Y-%m"),
                "indexValue": None,
                "forecastValue": round(float(row["mean"]), 4),
                "forecastLow": round(float(row["pi_lower"]), 4),
                "forecastHigh": round(float(row["pi_upper"]), 4),
            }
        )
    return points


def _write_warehouse_table(long_rows: list, warehouse_path: Path) -> bool:
    if not warehouse_path.exists():
        print(f"Skipping fact_market_trend: warehouse not found at {warehouse_path}.")
        return False

    import duckdb  # type: ignore[import-not-found]

    trend_frame = pd.DataFrame(long_rows)
    for column in ("index_value", "forecast_value", "forecast_low", "forecast_high"):
        trend_frame[column] = pd.to_numeric(trend_frame[column])

    connection = duckdb.connect(str(warehouse_path))
    try:
        connection.register("market_trend_source", trend_frame)
        connection.execute("CREATE OR REPLACE TABLE fact_market_trend AS SELECT * FROM market_trend_source")
    finally:
        connection.close()
    return True


def build_market_trend(
    *,
    csv_path: Path = DEFAULT_CSV_PATH,
    export_path: Path = DEFAULT_EXPORT_PATH,
    warehouse_path: Path = DEFAULT_WAREHOUSE_PATH,
) -> MarketTrendBuildSummary:
    frame = _read_nhpi_csv(csv_path)

    markets_payload = {}
    long_rows = []
    market_rows = {}
    last_observed = {}
    backtest_mape = {}

    for market in MARKETS:
        market_id = market["market_id"]
        series = _market_series(frame, market["geo"])
        spec, fit = _select_ets_fit(series)
        forecast_frame = _forecast_frame(fit, series)
        mape = _backtest_mape(series, spec)

        markets_payload[market_id] = {
            "status": "ready",
            "market": market_id,
            "marketLabel": market["label"],
            "method": _method_label(spec),
            "dataSource": DATA_SOURCE_NOTE,
            "baselinePeriod": series.index[-1].strftime("%Y-%m"),
            "backtestMape": round(mape, 4),
            "points": _points(series.iloc[-EXPORT_HISTORY_MONTHS:], forecast_frame),
        }
        for point in _points(series, forecast_frame):
            long_rows.append(
                {
                    "market_id": market_id,
                    "market_label": market["label"],
                    "period": point["period"],
                    "index_value": point["indexValue"],
                    "forecast_value": point["forecastValue"],
                    "forecast_low": point["forecastLow"],
                    "forecast_high": point["forecastHigh"],
                }
            )
        market_rows[market_id] = int(len(series))
        last_observed[market_id] = series.index[-1].strftime("%Y-%m")
        backtest_mape[market_id] = round(mape, 4)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Statistics Canada table 18-10-0205-01 (New Housing Price Index)",
        "license": "Open Government Licence - Canada",
        "markets": markets_payload,
    }

    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_text(json.dumps(payload, indent=2) + "\n")
    warehouse_table_written = _write_warehouse_table(long_rows, warehouse_path)

    return MarketTrendBuildSummary(
        export_path=export_path,
        market_rows=market_rows,
        last_observed=last_observed,
        backtest_mape=backtest_mape,
        warehouse_table_written=warehouse_table_written,
    )


def print_build_summary(summary: MarketTrendBuildSummary) -> None:
    print(f"Wrote {summary.export_path}")
    print(f"{'market':<20}{'rows':>6}  {'last observed':<15}{'backtest MAPE':>14}")
    for market_id, rows in summary.market_rows.items():
        mape_text = f"{summary.backtest_mape[market_id]:.2f}%"
        print(f"{market_id:<20}{rows:>6}  {summary.last_observed[market_id]:<15}{mape_text:>14}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the NHPI market trend index and ETS forecast export.")
    parser.add_argument("--download", action="store_true", help="Download the Statistics Canada table zip before building.")
    args = parser.parse_args()

    if args.download:
        download_statcan_table()
    print_build_summary(build_market_trend())


if __name__ == "__main__":
    main()
