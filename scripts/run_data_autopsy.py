#!/usr/bin/env python3
"""Regenerate data-autopsy CSV/JSON under reports/data-autopsy/."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "reports" / "data-autopsy"
DEFAULT_HAL_RAW = REPO_ROOT / "data" / "raw" / "halifax"
DEFAULT_YVR_RAW = REPO_ROOT / "data" / "raw" / "vancouver" / "data_bc.csv"


def _display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        resolved = path.resolve()
        try:
            return "~/" + str(resolved.relative_to(Path.home()))
        except ValueError:
            return resolved.name


def _col_profile(series: pd.Series, name: str) -> dict:
    n = len(series)
    nulls = int(series.isna().sum())
    empty = 0
    if series.dtype == object or pd.api.types.is_string_dtype(series):
        empty = int(series.astype(str).str.strip().isin(["", "nan", "None", "NA", "N/A", "-", "null"]).sum())
    out: dict = {
        "name": name,
        "dtype": str(series.dtype),
        "n": n,
        "nullCount": nulls,
        "nullRate": (nulls / n) if n else None,
        "emptyOrSentinelCount": empty,
        "nUnique": int(series.nunique(dropna=True)),
    }
    non = series.dropna()
    if len(non) == 0:
        return out
    out["topValues"] = [{"value": str(k), "count": int(v)} for k, v in non.astype(str).value_counts().head(10).items()]
    if pd.api.types.is_numeric_dtype(series):
        q = non.astype(float)
        out["numeric"] = {
            "min": float(q.min()),
            "p05": float(q.quantile(0.05)),
            "median": float(q.median()),
            "p95": float(q.quantile(0.95)),
            "max": float(q.max()),
            "zeros": int((q == 0).sum()),
            "negatives": int((q < 0).sum()),
        }
    return out


def _profile_frame(df: pd.DataFrame, label: str, grain: str, path: Path, profiles: dict) -> None:
    profiles[label] = {
        "label": label,
        "path": _display_path(path),
        "grain": grain,
        "rows": int(len(df)),
        "cols": int(df.shape[1]),
        "columns": list(map(str, df.columns)),
        "columnProfiles": [_col_profile(df[c], str(c)) for c in df.columns],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Regenerate data-autopsy report files.")
    parser.add_argument("--halifax-raw", default=str(DEFAULT_HAL_RAW))
    parser.add_argument("--vancouver-raw", default=str(DEFAULT_YVR_RAW))
    parser.add_argument("--out", default=str(OUT_DIR))
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    profiles: dict = {}
    notes: list[str] = []

    yvr_path = REPO_ROOT / "data/processed/vancouver_base_model_training.csv"
    hal_path = REPO_ROOT / "data/processed/halifax_base_model_training.csv"
    yvr = pd.read_csv(yvr_path)
    hal = pd.read_csv(hal_path)
    _profile_frame(yvr, "vancouver_processed_training", "one Vancouver listing training row", yvr_path, profiles)
    _profile_frame(hal, "halifax_processed_training", "one Halifax time-adjusted sale training row", hal_path, profiles)

    yvr.sample(min(50, len(yvr)), random_state=42).to_csv(out / "vancouver_random_50.csv", index=False)
    hal.sample(min(50, len(hal)), random_state=42).to_csv(out / "halifax_random_50.csv", index=False)
    yvr.nsmallest(20, "price").to_csv(out / "vancouver_cheapest_20.csv", index=False)
    yvr.nlargest(20, "price").to_csv(out / "vancouver_most_expensive_20.csv", index=False)
    hal.nsmallest(20, "price").to_csv(out / "halifax_cheapest_20.csv", index=False)
    hal.nlargest(20, "price").to_csv(out / "halifax_most_expensive_20.csv", index=False)

    soft: list[dict] = []
    for i, row in yvr.iterrows():
        reasons = []
        if row.bedrooms == 0:
            reasons.append("zero_beds")
        if row.bathrooms == 0:
            reasons.append("zero_baths")
        if not pd.isna(row.get("propertyTax")) and row.propertyTax == 1:
            reasons.append("tax_eq_1_suspicious")
        if reasons:
            soft.append({"market": "vancouver", "rowIndex": int(i), "reasons": "|".join(reasons), **row.to_dict()})
    for i, row in hal.iterrows():
        reasons = []
        if row.bedrooms == 0:
            reasons.append("zero_beds")
        if row.bathrooms == 0:
            reasons.append("zero_baths")
        if pd.isna(row.postalCode):
            reasons.append("missing_postal")
        if not pd.isna(row.get("ageYears")) and row.ageYears > 150:
            reasons.append("age_gt_150")
        if reasons:
            soft.append({"market": "halifax", "rowIndex": int(i), "reasons": "|".join(reasons), **{k: row.get(k) for k in hal.columns}})
    pd.DataFrame(soft).to_csv(out / "failed_sanity_rows.csv", index=False)
    notes.append(f"soft sanity flags: {len(soft)} ({Counter(s['reasons'] for s in soft).most_common(8)})")

    if "saleDate" in hal.columns:
        sd = pd.to_datetime(hal["saleDate"], errors="coerce")
        notes.append(f"Halifax saleDate coverage {int(sd.notna().sum())}/{len(hal)} min={sd.min()} max={sd.max()}")

    yvr_raw = Path(args.vancouver_raw)
    date_audit = {"found": yvr_raw.is_file(), "path": _display_path(yvr_raw)}
    if yvr_raw.is_file():
        raw = pd.read_csv(yvr_raw, low_memory=False)
        _profile_frame(raw, "vancouver_raw_data_bc", "BC scrape listing row", yvr_raw, profiles)
        date_cols = [c for c in raw.columns if re.search(r"date|listed|updated", c, re.I)]
        date_audit["dateColumns"] = {
            c: int(raw[c].notna().sum()) for c in date_cols
        }
        notes.append(f"Vancouver raw date non-nulls: {date_audit['dateColumns']}")
    profiles["vancouver_raw_date_audit"] = date_audit

    hal_raw = Path(args.halifax_raw)
    join_orphans: list[dict] = []
    if (hal_raw / "pvsc_parcel_sales_hrm.csv").is_file() and (hal_raw / "pvsc_dwelling_characteristics_hrm.csv").is_file():
        sales = pd.read_csv(hal_raw / "pvsc_parcel_sales_hrm.csv", low_memory=False)
        dwellings = pd.read_csv(hal_raw / "pvsc_dwelling_characteristics_hrm.csv", low_memory=False)
        sales["sale_date"] = pd.to_datetime(sales["sale_date"], errors="coerce")
        window = sales[(sales["sale_date"] >= "2022-01-01") & (pd.to_numeric(sales["sale_price"], errors="coerce") >= 100000)]
        d_keys = set(dwellings["aan"].dropna().astype(str))
        matched = window["aan"].astype(str).isin(d_keys)
        notes.append(f"sales->dwellings join {float(matched.mean()):.4%} ({int(matched.sum())}/{len(matched)})")
        orphans = window.loc[~matched].head(50)
        orphans.to_csv(out / "join_orphans_sales_without_dwelling.csv", index=False)
        for _, row in orphans.head(20).iterrows():
            join_orphans.append({"join": "sales_to_dwellings", "aan": row.get("aan"), "sale_date": str(row.get("sale_date")), "sale_price": row.get("sale_price")})

        sys.path.insert(0, str(REPO_ROOT / "scripts"))
        import build_halifax_uplift as uplift

        pairs, baseline = uplift.build_repeat_sale_pairs(sales)
        permits = uplift.load_hrm_permits(hal_raw / "hrm_building_permits_geolocated.csv")
        dwelling_points = uplift.load_dwelling_points(hal_raw / "pvsc_dwelling_characteristics_hrm.csv")
        matched_permits = uplift.match_permits_to_dwellings(permits, dwelling_points)
        treated, control, _ = uplift.classify_pairs(pairs, matched_permits)
        notes.append(f"uplift baseline={baseline} pairs={len(pairs)} control={len(control)} permitMatch={len(matched_permits)}/{len(permits)}")
        cm = float(control["adjustedRatio"].median())
        extreme_rows = []
        for category, frame in treated.items():
            frame.sample(min(10, len(frame)), random_state=0).to_csv(out / f"uplift_treated_{category}_random10.csv", index=False)
            tmp = frame.copy()
            tmp["excessUplift"] = tmp["adjustedRatio"] - cm
            for kind, part in [("high", tmp.nlargest(5, "excessUplift")), ("low", tmp.nsmallest(5, "excessUplift"))]:
                for _, row in part.iterrows():
                    extreme_rows.append(
                        {
                            "category": category,
                            "extremeKind": kind,
                            "aan": row["aan"],
                            "prevSaleDate": row["prevSaleDate"],
                            "nextSaleDate": row["nextSaleDate"],
                            "prevSalePrice": row["prevSalePrice"],
                            "nextSalePrice": row["nextSalePrice"],
                            "rawRatio": row["rawRatio"],
                            "adjustedRatio": row["adjustedRatio"],
                            "excessUplift": row["excessUplift"],
                            "pairId": row["pairId"],
                        }
                    )
            notes.append(f"treated {category}: {len(frame)}")
        control.sample(min(10, len(control)), random_state=0).to_csv(out / "uplift_control_random10.csv", index=False)
        pd.DataFrame(extreme_rows).to_csv(out / "extreme_uplift_pairs.csv", index=False)
    else:
        notes.append(f"Halifax raw dir missing or incomplete: {_display_path(hal_raw)}")

    pd.DataFrame(join_orphans).to_csv(out / "join_orphans.csv", index=False)
    (out / "column_profiles.json").write_text(json.dumps(profiles, indent=2, default=str))
    (out / "notes.json").write_text(json.dumps(notes, indent=2))
    print("Wrote autopsy artifacts to", out)
    for note in notes:
        print("-", note)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
