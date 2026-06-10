from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from scripts.setup_halifax_data import (  # noqa: E402
    DEFAULT_DWELLINGS_PATH,
    DEFAULT_PERMITS_PATH,
    DEFAULT_SALES_PATH,
    EARTH_RADIUS_METERS,
    INDEX_MIN_MARKET_PRICE,
    _monthly_sale_price_index,
)

DEFAULT_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "halifax_uplift.json"

MIN_PAIR_GAP_DAYS = 180
MIN_PAIR_SALE_PRICE = INDEX_MIN_MARKET_PRICE
RATIO_LOW, RATIO_HIGH = 0.5, 5.0
PERMIT_MATCH_MAX_METERS = 30.0
MIN_TREATED_PAIRS = 100
UPLIFT_CATEGORIES = ("Renovation", "Addition")
EXCLUDED_SCOPE = "New Building"
# The control distribution should sit near 1.0 once market drift is removed.
CONTROL_MEDIAN_TOLERANCE = 0.10

SOURCE = "PVSC Parcel Sales History repeat-sale pairs joined to HRM geolocated building permits (<= 30 m)"

FLAG_CATEGORY_MAP = {
    "renovatedKitchen": "Renovation",
    "renovatedBathrooms": "Renovation",
    "energyEfficient": "Renovation",
    "deferredMaintenanceResolved": "Renovation",
    "roofIssueResolved": "Renovation",
    "legalSuiteAdded": "Addition",
}


def _method_text(baseline_month: str, control_median: float) -> str:
    return (
        "Repeat-sale pairs are consecutive sales of the same PVSC assessment account at least "
        f"{MIN_PAIR_GAP_DAYS} days apart; pairs are dropped when either sale is below "
        f"${MIN_PAIR_SALE_PRICE:,} or the price ratio falls outside [{RATIO_LOW}, {RATIO_HIGH}] "
        "(non-market transfers). Both sale prices in each pair are time-adjusted to "
        f"{baseline_month} with the HRM monthly median sale-price index (3-month rolling median "
        "smoothing), so the pair ratio removes market drift. Permits join to dwellings by the "
        "nearest PVSC dwelling point within 30 m (the PID-to-civic-address join fails because the "
        "identifier formats differ). A pair is treated for a category when a permit of that "
        "PRIMARY_WORK_SCOPE was issued strictly between its two sale dates; 'New Building' "
        "permits are excluded as teardown/redevelopment rather than improvement of an existing "
        "dwelling, and pairs with a New Building permit between sales are removed from the "
        "treated sets. Controls are pairs with no permit of any scope between sales. Excess "
        "uplift per category is the median treated time-adjusted ratio minus the median control "
        "time-adjusted ratio, with p25/p75 taken from the treated distribution minus the control "
        f"median. Measured control median adjusted ratio: {control_median:.4f} "
        "(sanity-checked within +/-10% of 1.0)."
    )


def load_hrm_permits(path: Path | str = DEFAULT_PERMITS_PATH) -> pd.DataFrame:
    """Geolocated HRM permits with an issuance date. DATE_OF_PERMIT_ISSUANCE is epoch-milliseconds."""
    raw = pd.read_csv(path, low_memory=False)
    permits = pd.DataFrame(
        {
            "issuedDate": pd.to_datetime(
                pd.to_numeric(raw["DATE_OF_PERMIT_ISSUANCE"], errors="coerce"), unit="ms", errors="coerce"
            ),
            "workScope": raw["PRIMARY_WORK_SCOPE"].astype(str).str.strip(),
            "projectValue": pd.to_numeric(raw["ESTIMATED_PROJECT_VALUE"], errors="coerce"),
            "latitude": pd.to_numeric(raw["latitude"], errors="coerce"),
            "longitude": pd.to_numeric(raw["longitude"], errors="coerce"),
        }
    )
    return permits.dropna(subset=["issuedDate", "latitude", "longitude"]).reset_index(drop=True)


def load_dwelling_points(path: Path | str = DEFAULT_DWELLINGS_PATH) -> pd.DataFrame:
    """One coordinate per PVSC assessment account, for the permit spatial join."""
    raw = pd.read_csv(path, low_memory=False)
    dwellings = pd.DataFrame(
        {
            "aan": raw["aan"].astype(str),
            "latitude": pd.to_numeric(raw["y_coord"], errors="coerce"),
            "longitude": pd.to_numeric(raw["x_coord"], errors="coerce"),
        }
    )
    return dwellings.dropna(subset=["latitude", "longitude"]).drop_duplicates("aan").reset_index(drop=True)


def match_permits_to_dwellings(
    permits: pd.DataFrame,
    dwellings: pd.DataFrame,
    max_meters: float = PERMIT_MATCH_MAX_METERS,
) -> pd.DataFrame:
    """Nearest-dwelling spatial join, mirroring setup_halifax_data._assign_postal_codes."""
    from sklearn.neighbors import BallTree

    tree = BallTree(np.radians(dwellings[["latitude", "longitude"]].to_numpy(dtype=float)), metric="haversine")
    distances, indices = tree.query(np.radians(permits[["latitude", "longitude"]].to_numpy(dtype=float)), k=1)
    matched = permits.copy()
    matched["aan"] = dwellings["aan"].to_numpy()[indices[:, 0]]
    matched["matchDistanceMeters"] = distances[:, 0] * EARTH_RADIUS_METERS
    return matched[matched["matchDistanceMeters"] <= max_meters].reset_index(drop=True)


def build_repeat_sale_pairs(sales: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    """Consecutive same-account sale pairs with time-adjusted price ratios.

    The monthly index is built from the full market-priced sales history; the pair
    filter then keeps only pairs where both sales clear the market-price floor and
    the raw ratio is inside the non-market-transfer bounds."""
    sales = sales.copy()
    sales["sale_date"] = pd.to_datetime(sales["sale_date"], errors="coerce")
    sales = sales.dropna(subset=["sale_date", "sale_price", "aan"])
    sales["aan"] = sales["aan"].astype(str)

    index = _monthly_sale_price_index(sales)
    if index.empty:
        raise ValueError("No market-priced HRM sales were found to build the monthly index.")
    baseline_month = str(index.index.max())
    index_lookup = index.astype(float).to_dict()

    market = sales[sales["sale_price"] >= MIN_PAIR_SALE_PRICE].sort_values(["aan", "sale_date"])
    previous = market.groupby("aan")[["sale_date", "sale_price"]].shift(1)
    pairs = pd.DataFrame(
        {
            "aan": market["aan"],
            "prevSaleDate": previous["sale_date"],
            "nextSaleDate": market["sale_date"],
            "prevSalePrice": previous["sale_price"].astype(float),
            "nextSalePrice": market["sale_price"].astype(float),
        }
    ).dropna(subset=["prevSaleDate", "prevSalePrice"])

    pairs = pairs[(pairs["nextSaleDate"] - pairs["prevSaleDate"]).dt.days >= MIN_PAIR_GAP_DAYS]
    pairs["rawRatio"] = pairs["nextSalePrice"] / pairs["prevSalePrice"]
    pairs = pairs[pairs["rawRatio"].between(RATIO_LOW, RATIO_HIGH)]

    prev_index = pairs["prevSaleDate"].dt.to_period("M").map(index_lookup)
    next_index = pairs["nextSaleDate"].dt.to_period("M").map(index_lookup)
    # adjusted ratio = (next / index[next month]) / (prev / index[prev month])
    pairs["adjustedRatio"] = pairs["rawRatio"] * (prev_index.astype(float) / next_index.astype(float))
    pairs = pairs.dropna(subset=["adjustedRatio"]).reset_index(drop=True)
    pairs["pairId"] = np.arange(len(pairs))
    return pairs, baseline_month


def classify_pairs(
    pairs: pd.DataFrame,
    permits: pd.DataFrame,
) -> tuple[dict[str, pd.DataFrame], pd.DataFrame, dict[str, pd.Series]]:
    """Split pairs into per-category treated sets and a no-permit control set.

    Pairs with a New Building permit between sales are excluded from both sides:
    they are redevelopment, not improvement of an existing dwelling."""
    merged = pairs[["pairId", "aan", "prevSaleDate", "nextSaleDate"]].merge(
        permits[["aan", "issuedDate", "workScope", "projectValue"]], on="aan", how="inner"
    )
    between = merged[(merged["issuedDate"] > merged["prevSaleDate"]) & (merged["issuedDate"] < merged["nextSaleDate"])]
    pairs_with_any_permit = set(between["pairId"])
    new_building_pairs = set(between.loc[between["workScope"].eq(EXCLUDED_SCOPE), "pairId"])

    control = pairs[~pairs["pairId"].isin(pairs_with_any_permit)].reset_index(drop=True)
    treated_by_category: dict[str, pd.DataFrame] = {}
    permit_values_by_category: dict[str, pd.Series] = {}
    for category in UPLIFT_CATEGORIES:
        category_rows = between[between["workScope"].eq(category) & ~between["pairId"].isin(new_building_pairs)]
        treated_by_category[category] = pairs[pairs["pairId"].isin(set(category_rows["pairId"]))].reset_index(drop=True)
        permit_values_by_category[category] = category_rows["projectValue"].dropna().astype(float)
    return treated_by_category, control, permit_values_by_category


def _category_payload(
    category: str,
    treated: pd.DataFrame,
    control_pairs: int,
    control_median: float,
    permit_values: pd.Series,
) -> dict[str, Any]:
    treated_count = int(len(treated))
    if treated_count < MIN_TREATED_PAIRS:
        return {
            "status": "insufficient-data",
            "treatedPairs": treated_count,
            "controlPairs": control_pairs,
            "medianExcessUpliftPercent": None,
            "p25ExcessUpliftPercent": None,
            "p75ExcessUpliftPercent": None,
            "medianPermitValue": None,
            "note": (
                f"Only {treated_count} treated {category} pairs were measured; "
                f"{MIN_TREATED_PAIRS} are required before the {category} uplift is reported."
            ),
        }

    ratios = treated["adjustedRatio"].astype(float)
    return {
        "status": "ready",
        "treatedPairs": treated_count,
        "controlPairs": control_pairs,
        "medianExcessUpliftPercent": round(float(ratios.median() - control_median), 4),
        "p25ExcessUpliftPercent": round(float(ratios.quantile(0.25) - control_median), 4),
        "p75ExcessUpliftPercent": round(float(ratios.quantile(0.75) - control_median), 4),
        "medianPermitValue": int(round(float(permit_values.median()))) if len(permit_values) else None,
        "note": (
            f"Median time-adjusted repeat-sale ratio of {treated_count} treated {category} pairs minus the "
            f"{control_pairs}-pair control median ({control_median:.4f}). p25/p75 come from the treated "
            "distribution minus the control median, so the band reflects observed spread, not model error."
        ),
    }


def build_halifax_uplift_export(
    *,
    sales_path: Path | str = DEFAULT_SALES_PATH,
    permits_path: Path | str = DEFAULT_PERMITS_PATH,
    dwellings_path: Path | str = DEFAULT_DWELLINGS_PATH,
    export_path: Path | str = DEFAULT_EXPORT_PATH,
) -> dict[str, Any]:
    sales = pd.read_csv(sales_path, low_memory=False)
    pairs, baseline_month = build_repeat_sale_pairs(sales)

    permits = load_hrm_permits(permits_path)
    dwellings = load_dwelling_points(dwellings_path)
    matched_permits = match_permits_to_dwellings(permits, dwellings)

    treated_by_category, control, permit_values = classify_pairs(pairs, matched_permits)
    control_median = float(control["adjustedRatio"].median())
    if not (1.0 - CONTROL_MEDIAN_TOLERANCE <= control_median <= 1.0 + CONTROL_MEDIAN_TOLERANCE):
        raise ValueError(
            f"Control median adjusted ratio {control_median:.4f} is outside +/-10% of 1.0 — "
            "the time adjustment did not remove market drift, so the export was not written."
        )

    categories = {
        category: _category_payload(
            category,
            treated_by_category[category],
            int(len(control)),
            control_median,
            permit_values[category],
        )
        for category in UPLIFT_CATEGORIES
    }

    export = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": SOURCE,
        "method": _method_text(baseline_month, control_median),
        "baselineMonth": baseline_month,
        "minTreatedPairs": MIN_TREATED_PAIRS,
        "categories": categories,
        "flagCategoryMap": dict(FLAG_CATEGORY_MAP),
    }

    export_path = Path(export_path)
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_text(json.dumps(export, indent=2) + "\n", encoding="utf-8")

    print(f"Repeat-sale pairs: {len(pairs):,} (>= ${MIN_PAIR_SALE_PRICE:,}, ratio in [{RATIO_LOW}, {RATIO_HIGH}])")
    print(f"Permits matched within {PERMIT_MATCH_MAX_METERS:.0f} m: {len(matched_permits):,} of {len(permits):,}")
    print(f"Control pairs: {len(control):,} | control median adjusted ratio: {control_median:.4f}")
    header = f"{'category':<12}{'status':<20}{'treated':>8}{'control':>9}{'medianExcess':>14}{'p25':>9}{'p75':>9}{'permit$':>10}"
    print(header)
    for category, payload in categories.items():
        median_excess = payload["medianExcessUpliftPercent"]
        p25 = payload["p25ExcessUpliftPercent"]
        p75 = payload["p75ExcessUpliftPercent"]
        permit_value = payload["medianPermitValue"]
        print(
            f"{category:<12}{payload['status']:<20}{payload['treatedPairs']:>8}{payload['controlPairs']:>9}"
            f"{median_excess if median_excess is not None else '—':>14}"
            f"{p25 if p25 is not None else '—':>9}{p75 if p75 is not None else '—':>9}"
            f"{int(permit_value) if permit_value is not None else '—':>10}"
        )
    print(f"Wrote {export_path}")
    return export


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the observed Halifax renovation-uplift export from PVSC repeat sales and HRM permits."
    )
    parser.add_argument("--sales", default=str(DEFAULT_SALES_PATH), help="PVSC parcel sales CSV path")
    parser.add_argument("--permits", default=str(DEFAULT_PERMITS_PATH), help="HRM geolocated permits CSV path")
    parser.add_argument("--dwellings", default=str(DEFAULT_DWELLINGS_PATH), help="PVSC dwelling characteristics CSV path")
    parser.add_argument("--out", default=str(DEFAULT_EXPORT_PATH), help="Export JSON path")
    args = parser.parse_args()

    build_halifax_uplift_export(
        sales_path=args.sales,
        permits_path=args.permits,
        dwellings_path=args.dwellings,
        export_path=args.out,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
