from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd

from scripts.http_fetch import fetch_bytes, write_bytes_atomically
from scripts.identities import assign_sale_identity
from scripts.output_guard import public_storage_ref, strict_from_env
from scripts.release_store import content_sha256


REPO_ROOT = Path(__file__).resolve().parents[1]
RAW_HALIFAX_DIR = REPO_ROOT / "data" / "raw" / "halifax"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
DEFAULT_TRAINING_OUTPUT_PATH = PROCESSED_DIR / "halifax_base_model_training.csv"
DEFAULT_TRAINING_SUMMARY_PATH = PROCESSED_DIR / "halifax_base_model_summary.json"

HRM_MUNICIPAL_UNIT = "HALIFAX REGIONAL MUNICIPALITY (HRM)"
MIN_SALE_PRICE = 10_000
MIN_SALE_DATE = "2015-01-01T00:00:00"
MIN_ASSESSMENT_TAX_YEAR = 2025

DATAZONE_HOST = "https://www.thedatazone.ca"
DATAZONE_PAGE_SIZE = 50_000
ARCGIS_PAGE_SIZE = 2_000

# PVSC open data on datazONE (Socrata). All datasets join on the assessment
# account number (aan) and carry WGS84 coordinates but no postal codes.
DWELLINGS_DATASET = ("a859-xvcs", "Residential Dwelling Characteristics")
SALES_DATASET = ("6a95-ppg4", "Parcel Sales History")
ASSESSMENTS_DATASET = ("bt58-qu28", "Assessed Value and Taxable Assessed Value History")

# HRM open data (ArcGIS). Civic addresses are the only open postal-code source
# for the region, so they double as the postal/FSA bridge for PVSC parcels.
HRM_CIVIC_ADDRESS_SERVICE = (
    "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/CivicAddresses/FeatureServer/0"
)
HRM_PERMITS_SERVICE = (
    "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/PPLC_Permits_Geolocated/FeatureServer/0"
)
HRM_CIVIC_ADDRESS_FIELDS = "PID,CIV_POSTAL,FULL_CIVIC,STR_NAME,STR_TYPE,GSA_NAME"

DEFAULT_DWELLINGS_PATH = os.environ.get(
    "HALIFAX_DWELLINGS_PATH", str(RAW_HALIFAX_DIR / "pvsc_dwelling_characteristics_hrm.csv")
)
DEFAULT_SALES_PATH = os.environ.get(
    "HALIFAX_SALES_PATH", str(RAW_HALIFAX_DIR / "pvsc_parcel_sales_hrm.csv")
)
DEFAULT_ASSESSMENTS_PATH = os.environ.get(
    "HALIFAX_ASSESSMENTS_PATH", str(RAW_HALIFAX_DIR / "pvsc_assessed_values_hrm.csv")
)
DEFAULT_CIVIC_ADDRESSES_PATH = os.environ.get(
    "HALIFAX_CIVIC_ADDRESSES_PATH", str(RAW_HALIFAX_DIR / "hrm_civic_addresses.csv")
)
DEFAULT_PERMITS_PATH = os.environ.get(
    "HALIFAX_PERMITS_PATH", str(RAW_HALIFAX_DIR / "hrm_building_permits_geolocated.csv")
)


def _path(value: str) -> Path:
    return Path(value).expanduser().resolve()


def _fetch(url: str) -> bytes:
    return fetch_bytes(url, attempts=3, timeout=300)


def _write_frame_atomically(frame: pd.DataFrame, destination: Path) -> None:
    """A partial CSV must not replace a completed snapshot."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".partial")
    try:
        frame.to_csv(partial, index=False)
        payload = partial.read_bytes()
        partial.unlink(missing_ok=True)
        write_bytes_atomically(destination, payload)
    except Exception:
        partial.unlink(missing_ok=True)
        raise


def _resolve_reference_date(explicit: str | None, strict: bool) -> str:
    value = explicit or os.environ.get("CVH_REFERENCE_DATE")
    if value:
        datetime.fromisoformat(value)
        return value
    if strict:
        raise RuntimeError(
            "Strict Halifax extract building requires --reference-date or CVH_REFERENCE_DATE. "
            "ageYears must not silently follow the wall clock."
        )
    today = datetime.now(timezone.utc).date().isoformat()
    print(
        f"WARNING: ageYears uses wall-clock date {today}. "
        "Pass --reference-date for a reproducible extract."
    )
    return today


def _download_datazone_csv(dataset_id: str, label: str, destination: Path, where: str) -> None:
    """Page through a Socrata dataset and write one combined CSV."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    pages: list[pd.DataFrame] = []
    offset = 0
    while True:
        params = urllib.parse.urlencode(
            {
                "$where": where,
                "$order": ":id",
                "$limit": DATAZONE_PAGE_SIZE,
                "$offset": offset,
            }
        )
        url = f"{DATAZONE_HOST}/resource/{dataset_id}.csv?{params}"
        print(f"Downloading {label} rows {offset:,}-{offset + DATAZONE_PAGE_SIZE:,}")
        page = pd.read_csv(io.BytesIO(_fetch(url)), low_memory=False)
        if page.empty:
            break
        pages.append(page)
        if len(page) < DATAZONE_PAGE_SIZE:
            break
        offset += DATAZONE_PAGE_SIZE

    if not pages:
        raise RuntimeError(f"No rows returned for {label}; check the datazONE filters.")

    combined = pd.concat(pages, ignore_index=True)
    _write_frame_atomically(combined, destination)
    print(f"Saved {len(combined):,} {label} rows to {destination}")


def _download_arcgis_csv(service_url: str, label: str, destination: Path, out_fields: str = "*") -> None:
    """Page through an ArcGIS FeatureServer layer and write one combined CSV with lon/lat columns."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    offset = 0
    while True:
        params = urllib.parse.urlencode(
            {
                "where": "1=1",
                "outFields": out_fields,
                "outSR": 4326,
                "f": "json",
                "resultOffset": offset,
                "resultRecordCount": ARCGIS_PAGE_SIZE,
            }
        )
        print(f"Downloading {label} rows {offset:,}-{offset + ARCGIS_PAGE_SIZE:,}")
        payload = json.loads(_fetch(f"{service_url}/query?{params}"))
        if "error" in payload:
            raise RuntimeError(f"ArcGIS error for {label}: {payload['error']}")

        features = payload.get("features", [])
        if not features:
            break
        for feature in features:
            row = dict(feature.get("attributes", {}))
            geometry = feature.get("geometry") or {}
            row["longitude"] = geometry.get("x")
            row["latitude"] = geometry.get("y")
            rows.append(row)
        if not payload.get("exceededTransferLimit", False) and len(features) < ARCGIS_PAGE_SIZE:
            break
        offset += len(features)

    if not rows:
        raise RuntimeError(f"No rows returned for {label}; check the ArcGIS service URL.")

    combined = pd.DataFrame(rows)
    _write_frame_atomically(combined, destination)
    print(f"Saved {len(combined):,} {label} rows to {destination}")


def parse_arcgis_editing_info(payload: dict) -> dict | None:
    """Read a FeatureServer layer's data edit time, or None when it is absent.

    ArcGIS reports editingInfo.dataLastEditDate as epoch milliseconds. That is
    the layer document's edit time, not a per-row observation time. A missing
    field stays unknown.
    """
    editing = payload.get("editingInfo")
    if not isinstance(editing, dict) or editing.get("dataLastEditDate") is None:
        return None
    try:
        data_ms = int(editing["dataLastEditDate"])
    except (TypeError, ValueError):
        return None
    source = datetime.fromtimestamp(data_ms / 1000, timezone.utc).isoformat()
    schema = None
    if editing.get("schemaLastEditDate") is not None:
        try:
            schema = datetime.fromtimestamp(int(editing["schemaLastEditDate"]) / 1000, timezone.utc).isoformat()
        except (TypeError, ValueError):
            schema = None
    return {
        "sourceUpdatedAt": source,
        "sourceUpdateField": "editingInfo.dataLastEditDate",
        "schemaLastEditDate": schema,
        "dataAndSchemaTimestampsEqual": schema == source,
    }


def fetch_arcgis_source_update(service_url: str) -> dict | None:
    payload = json.loads(_fetch(f"{service_url}?f=json"))
    if "error" in payload:
        raise RuntimeError(f"ArcGIS layer metadata error for {service_url}: {payload['error']}")
    return parse_arcgis_editing_info(payload)


def apply_arcgis_source_updates(manifest: dict, updates: dict[str, dict | None]) -> dict:
    """Fill sourceUpdatedAt only for layers whose metadata actually has a data edit time."""
    revised = json.loads(json.dumps(manifest))
    for row in revised.get("snapshots", []):
        info = updates.get(row.get("name"))
        if not info:
            continue
        row["sourceUpdatedAt"] = info["sourceUpdatedAt"]
        row["sourceUpdateField"] = info["sourceUpdateField"]
        row["schemaLastEditDate"] = info["schemaLastEditDate"]
        row["dataAndSchemaTimestampsEqual"] = info["dataAndSchemaTimestampsEqual"]
        note = (
            "sourceUpdatedAt is FeatureServer editingInfo.dataLastEditDate. "
            "It is the layer document's data edit time, not a per-row observation time."
        )
        if info["dataAndSchemaTimestampsEqual"]:
            note += " dataLastEditDate and schemaLastEditDate are the same instant."
        row["sourceObservationPeriod"] = note
    return revised


ARCGIS_SOURCE_LAYERS = {
    "hrm_civic_addresses": HRM_CIVIC_ADDRESS_SERVICE,
    "hrm_permits": HRM_PERMITS_SERVICE,
}


def record_arcgis_source_updates(manifest_path: Path | None = None) -> dict:
    """Refresh civic and permit source-update times on an existing acquisition manifest."""
    manifest_path = manifest_path or (RAW_HALIFAX_DIR / "acquisition_manifest.json")
    updates = {name: fetch_arcgis_source_update(url) for name, url in ARCGIS_SOURCE_LAYERS.items()}
    if not manifest_path.is_file():
        return {"updates": updates, "manifestWritten": False}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    revised = apply_arcgis_source_updates(manifest, updates)
    write_bytes_atomically(manifest_path, (json.dumps(revised, indent=2) + "\n").encode("utf-8"))
    return {"updates": updates, "manifestWritten": True, "manifest": revised}


def download_pvsc() -> None:
    hrm_filter = f"municipal_unit='{HRM_MUNICIPAL_UNIT}'"
    _download_datazone_csv(
        DWELLINGS_DATASET[0],
        DWELLINGS_DATASET[1],
        _path(DEFAULT_DWELLINGS_PATH),
        where=hrm_filter,
    )
    _download_datazone_csv(
        SALES_DATASET[0],
        SALES_DATASET[1],
        _path(DEFAULT_SALES_PATH),
        where=(
            f"{hrm_filter} AND sale_date >= '{MIN_SALE_DATE}' "
            f"AND parcels_in_sale = 1 AND sale_price > {MIN_SALE_PRICE}"
        ),
    )
    _download_datazone_csv(
        ASSESSMENTS_DATASET[0],
        ASSESSMENTS_DATASET[1],
        _path(DEFAULT_ASSESSMENTS_PATH),
        where=f"{hrm_filter} AND tax_year >= {MIN_ASSESSMENT_TAX_YEAR}",
    )


def download_hrm() -> None:
    _download_arcgis_csv(
        HRM_CIVIC_ADDRESS_SERVICE,
        "HRM civic addresses",
        _path(DEFAULT_CIVIC_ADDRESSES_PATH),
        out_fields=HRM_CIVIC_ADDRESS_FIELDS,
    )
    _download_arcgis_csv(
        HRM_PERMITS_SERVICE,
        "HRM building permits (geolocated)",
        _path(DEFAULT_PERMITS_PATH),
    )
    recorded = record_arcgis_source_updates()
    if recorded["manifestWritten"]:
        print("Recorded ArcGIS editingInfo.dataLastEditDate on the acquisition manifest.")
    else:
        print("ArcGIS source-update times were fetched. No acquisition manifest was present to update.")


# Training extract configuration. See docs/halifax-data-recon.md for the measured
# join rates and the rationale behind each decision.
TRAINING_WINDOW_START = "2022-01-01"
INDEX_MIN_MARKET_PRICE = 100_000
POSTAL_MATCH_MAX_METERS = 150.0
EARTH_RADIUS_METERS = 6_371_000.0
H3_RESOLUTION = 8
MIN_SALE_TO_DWELLING_JOIN_RATE = 0.90
MAX_AGE_YEARS = 150

# PVSC styles cover ground-oriented dwellings only; condo apartment units have no
# usable characteristics in the open data, so Halifax has no Condo property type.
STYLE_PROPERTY_TYPE_RULES = (
    ("townhouse", "Townhouse"),
    ("semi detached", "Duplex"),
    ("duplex", "Duplex"),
    ("triplex", "Duplex"),
    ("quadruplex", "Duplex"),
    ("storey", "Detached"),
    ("split entry", "Detached"),
    ("split level", "Detached"),
)


def _normalize_halifax_postal(value: object) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    code = str(value).strip().upper().replace(" ", "")
    if len(code) == 6 and code[0] == "B":
        return code
    return None


def _map_style_to_property_type(style: object) -> str | None:
    if not isinstance(style, str):
        return None
    lowered = style.lower()
    for token, property_type in STYLE_PROPERTY_TYPE_RULES:
        if token in lowered:
            return property_type
    return None


def _zero_pad_match_delta(window_accounts: pd.Series, eligible_accounts: pd.Series) -> int:
    """How many extra denominator accounts would match if both sides were zero-padded.

    A non-zero delta means the join is dropping rows because of account-number
    formatting. Zero means padding is not the miss.
    """

    def pad(series: pd.Series) -> pd.Series:
        text = series.astype(str).str.replace(r"\.0$", "", regex=True)
        return text.str.zfill(8)

    raw_matches = int(window_accounts.astype(str).isin(set(eligible_accounts.astype(str))).sum())
    padded_matches = int(pad(window_accounts).isin(set(pad(eligible_accounts))).sum())
    return padded_matches - raw_matches


def classify_unmatched_sale_accounts(
    window_accounts: pd.Series,
    dwellings: pd.DataFrame,
    eligible_accounts: pd.Series,
) -> dict:
    """Partition denominator accounts that miss the eligible-dwelling join.

    The denominator is unchanged. These counts explain the miss; they do not
    remove accounts from it. An eligible dwelling row that still failed to join
    is reported as eligibleRowNotJoined rather than being forced into a match.
    """
    unmatched = pd.Series(window_accounts, dtype="object").astype(str).drop_duplicates()
    eligible = set(pd.Series(eligible_accounts, dtype="object").astype(str))
    unmatched = unmatched[~unmatched.isin(eligible)]
    reasons = {
        "noDwellingRow": 0,
        "eligibleRowNotJoined": 0,
        "styleUnmapped": 0,
        "underConstruction": 0,
        "livingUnitsOutside1To4": 0,
        "other": 0,
    }
    if unmatched.empty:
        return {
            "unmatchedAccounts": 0,
            "reasons": reasons,
            "styleUnmappedAccountStyles": {},
            "reasonCountsSumToUnmatched": True,
        }

    dwell = dwellings.copy()
    dwell["aan"] = dwell["aan"].astype(str)
    related = dwell[dwell["aan"].isin(set(unmatched))].copy()
    related["passesUnits"] = related["living_units"].between(1, 4)
    related["passesConstruction"] = related["under_construction"].eq("N")
    related["passesStyle"] = related["style"].map(_map_style_to_property_type).notna()
    related["eligibleRow"] = related["passesConstruction"] & related["passesUnits"] & related["passesStyle"]
    related["passesConstructionAndUnits"] = related["passesConstruction"] & related["passesUnits"]

    if related.empty:
        flags = pd.DataFrame(index=pd.Index([], name="aan"))
    else:
        flags = related.groupby("aan", sort=False).agg(
            any_eligible=("eligibleRow", "any"),
            any_construction_and_units=("passesConstructionAndUnits", "any"),
            any_construction=("passesConstruction", "any"),
            any_units=("passesUnits", "any"),
        )
    have_dwelling = set(flags.index.astype(str))

    labels = []
    for aan in unmatched:
        if aan not in have_dwelling:
            label = "noDwellingRow"
        elif bool(flags.at[aan, "any_eligible"]):
            label = "eligibleRowNotJoined"
        elif bool(flags.at[aan, "any_construction_and_units"]):
            label = "styleUnmapped"
        elif not bool(flags.at[aan, "any_construction"]):
            label = "underConstruction"
        elif not bool(flags.at[aan, "any_units"]):
            label = "livingUnitsOutside1To4"
        else:
            label = "other"
        reasons[label] += 1
        labels.append(label)

    style_counts: dict[str, int] = {}
    if not related.empty:
        style_accounts = related[related["passesConstructionAndUnits"]].drop_duplicates("aan")
        style_accounts = style_accounts[style_accounts["aan"].isin(
            [aan for aan, label in zip(unmatched, labels) if label == "styleUnmapped"]
        )]
        style_labels = style_accounts["style"].map(lambda value: "null" if not isinstance(value, str) else value)
        style_counts = {str(key): int(value) for key, value in style_labels.value_counts().items()}

    partition_ok = sum(reasons.values()) == int(len(unmatched))
    if not partition_ok:
        raise RuntimeError("Unmatched-account reasons do not sum to the unmatched denominator accounts.")
    return {
        "unmatchedAccounts": int(len(unmatched)),
        "reasons": reasons,
        "styleUnmappedAccountStyles": style_counts,
        "reasonCountsSumToUnmatched": True,
    }


def _h3_cell(latitude: float, longitude: float) -> str | None:
    try:
        import h3
    except ModuleNotFoundError:
        return None
    if hasattr(h3, "latlng_to_cell"):
        return str(h3.latlng_to_cell(latitude, longitude, H3_RESOLUTION))
    return str(h3.geo_to_h3(latitude, longitude, H3_RESOLUTION))


def _monthly_sale_price_index(sales: pd.DataFrame) -> pd.Series:
    """Monthly median sale price for market-priced HRM sales, smoothed with a
    3-month rolling median. Used to time-adjust older sales to the latest month."""
    market_sales = sales[sales["sale_price"] >= INDEX_MIN_MARKET_PRICE].copy()
    market_sales["month"] = market_sales["sale_date"].dt.to_period("M")
    monthly_median = market_sales.groupby("month")["sale_price"].median().sort_index()
    smoothed = monthly_median.rolling(window=3, min_periods=1, center=True).median()
    return smoothed


def _time_adjustment_factors(sales: pd.DataFrame) -> tuple[pd.Series, str]:
    index = _monthly_sale_price_index(sales)
    latest_month = index.index.max()
    latest_value = float(index.loc[latest_month])
    months = sales["sale_date"].dt.to_period("M")
    factors = months.map(lambda month: latest_value / float(index.loc[month]) if month in index.index else np.nan)
    factors = factors.clip(lower=0.5, upper=2.0)
    return factors, str(latest_month)


def _assign_postal_codes(frame: pd.DataFrame, civic: pd.DataFrame) -> tuple[pd.Series, float]:
    """Nearest civic-address postal code within POSTAL_MATCH_MAX_METERS, else None.

    The HRM civic address layer is the only open postal-code source for the
    region; PVSC parcels carry coordinates but no postal codes."""
    from sklearn.neighbors import BallTree

    civic = civic.dropna(subset=["latitude", "longitude"]).copy()
    civic["postal"] = civic["CIV_POSTAL"].map(_normalize_halifax_postal)
    civic = civic.dropna(subset=["postal"])

    tree = BallTree(np.radians(civic[["latitude", "longitude"]].to_numpy()), metric="haversine")
    distances, indices = tree.query(np.radians(frame[["latitude", "longitude"]].to_numpy()), k=1)
    meters = distances[:, 0] * EARTH_RADIUS_METERS
    postals = civic["postal"].to_numpy()[indices[:, 0]]
    matched = pd.Series(
        np.where(meters <= POSTAL_MATCH_MAX_METERS, postals, None),
        index=frame.index,
        dtype="object",
    )
    return matched, float((meters <= POSTAL_MATCH_MAX_METERS).mean())


def _source_snapshot(path: Path) -> dict:
    return {
        "storageRef": public_storage_ref(path),
        "contentSha256": content_sha256(path) if path.is_file() else None,
        "bytes": path.stat().st_size if path.is_file() else None,
    }


def build_training_extract(
    *,
    dwellings_path: Path | None = None,
    sales_path: Path | None = None,
    assessments_path: Path | None = None,
    civic_addresses_path: Path | None = None,
    output_path: Path | None = None,
    summary_path: Path | None = None,
    strict: bool = False,
    reference_date: str | None = None,
) -> dict:
    dwellings_path = dwellings_path or _path(DEFAULT_DWELLINGS_PATH)
    sales_path = sales_path or _path(DEFAULT_SALES_PATH)
    assessments_path = assessments_path or _path(DEFAULT_ASSESSMENTS_PATH)
    civic_addresses_path = civic_addresses_path or _path(DEFAULT_CIVIC_ADDRESSES_PATH)
    output_path = output_path or DEFAULT_TRAINING_OUTPUT_PATH
    summary_path = summary_path or DEFAULT_TRAINING_SUMMARY_PATH

    for label, path in (
        ("dwelling characteristics", dwellings_path),
        ("parcel sales", sales_path),
        ("assessed values", assessments_path),
        ("civic addresses", civic_addresses_path),
    ):
        if not path.exists():
            raise FileNotFoundError(
                f"Missing Halifax {label} file: {path}. Run setup_halifax_data.py --download-pvsc --download-hrm first."
            )

    dwellings = pd.read_csv(dwellings_path, low_memory=False)
    sales = pd.read_csv(sales_path, low_memory=False)
    assessments = pd.read_csv(assessments_path, low_memory=False)
    civic = pd.read_csv(civic_addresses_path, low_memory=False)

    sales_source_rows = int(len(sales))
    sales["sale_date"] = pd.to_datetime(sales["sale_date"], errors="coerce")
    missing_sale_key = sales["sale_date"].isna() | sales["sale_price"].isna() | sales["aan"].isna()
    excluded_missing_sale_key = int(missing_sale_key.sum())
    sales = sales.loc[~missing_sale_key].copy()
    if sales.empty:
        raise RuntimeError(
            "Halifax sales snapshot has no rows with aan, sale_date, and sale_price. "
            "The raw file was not modified."
        )
    sales["aan"] = sales["aan"].map(lambda value: str(value).strip())
    # Identify every sale before keeping the latest sale per account. aan is not unique.
    sales = sales.join(assign_sale_identity(sales))
    identity_kinds = sorted({str(value) for value in sales["identityKind"].dropna().unique()}) if len(sales) else []
    cross_values = sorted({str(value) for value in sales["crossSnapshotMatch"].dropna().unique()}) if len(sales) else []
    identity_kind = identity_kinds[0] if len(identity_kinds) == 1 else ",".join(identity_kinds) or "none"
    cross_snapshot = cross_values[0] if len(cross_values) == 1 else ",".join(cross_values) or "unsupported"

    factors, index_latest_month = _time_adjustment_factors(sales)
    sales["timeAdjustmentFactor"] = factors

    before_window = int(len(sales))
    window_sales = sales[sales["sale_date"] >= TRAINING_WINDOW_START].copy()
    excluded_before_window = before_window - int(len(window_sales))
    sales_aan_max = int(window_sales.groupby("aan").size().max()) if len(window_sales) else 0
    excluded_older_sales = int(window_sales["aan"].duplicated().sum())
    window_sales = window_sales.sort_values(["sale_date", "saleObservationId"]).drop_duplicates("aan", keep="last")

    dwellings["aan"] = dwellings["aan"].astype(str)
    dwelling_source_rows = int(len(dwellings))
    construction_excluded = int((dwellings["under_construction"] != "N").sum())
    units_excluded = int((~dwellings["living_units"].between(1, 4)).sum())
    eligible = dwellings[
        (dwellings["under_construction"] == "N") & dwellings["living_units"].between(1, 4)
    ].copy()
    eligible["propertyType"] = eligible["style"].map(_map_style_to_property_type)
    style_excluded = int(eligible["propertyType"].isna().sum())
    eligible = eligible.dropna(subset=["propertyType"])
    dwelling_aan_max = int(eligible.groupby("aan").size().max()) if len(eligible) else 0
    excluded_extra_dwelling_rows = int(eligible["aan"].duplicated().sum())
    eligible = eligible.drop_duplicates("aan", keep="first")

    dwelling_columns = eligible[
        ["aan", "propertyType", "square_foot_living_area", "bedrooms", "bathrooms", "year_built", "y_coord", "x_coord"]
    ].rename(
        columns={
            "square_foot_living_area": "livingAreaSqft",
            "year_built": "yearBuilt",
            "y_coord": "dwellingLatitude",
            "x_coord": "dwellingLongitude",
        }
    )

    joined = window_sales.merge(dwelling_columns, on="aan", how="inner")
    join_numerator = int(len(joined))
    join_denominator = int(len(window_sales))
    join_numerator_name = "window_sales_after_latest_per_aan_inner_joined_to_eligible_dwellings"
    join_denominator_name = "latest_sale_per_aan_on_or_after_training_window_start"
    matched_accounts = int(joined["aan"].nunique())
    unmatched_accounts = join_denominator - matched_accounts
    joined_per_account_max = int(joined.groupby("aan").size().max()) if len(joined) else 0
    join_rate = join_numerator / join_denominator if join_denominator else 0.0
    unmatched_classification = classify_unmatched_sale_accounts(
        window_sales["aan"],
        dwellings,
        eligible["aan"],
    )
    join_audit = {
        "inputCapability": "raw_sales_and_dwellings",
        "remeasured": True,
        "eligibleSourcePopulation": {
            "name": "downloaded_hrm_sales_with_aan_sale_date_and_sale_price",
            "count": int(len(sales)),
        },
        "denominatorName": join_denominator_name,
        "denominator": join_denominator,
        "numeratorName": join_numerator_name,
        "numerator": join_numerator,
        "matchedAccounts": matched_accounts,
        "unmatchedAccounts": unmatched_accounts,
        "measuredRate": join_rate,
        "threshold": MIN_SALE_TO_DWELLING_JOIN_RATE,
        "exclusionCountsOverlap": True,
        "exclusions": {
            "salesMissingAanDateOrPrice": excluded_missing_sale_key,
            "salesBeforeTrainingWindow": excluded_before_window,
            "olderSalesCollapsedToLatestPerAan": excluded_older_sales,
            "dwellingsNotUnderConstructionN": construction_excluded,
            "dwellingsLivingUnitsOutside1To4": units_excluded,
            "dwellingsStyleUnmapped": style_excluded,
            "extraDwellingRowsCollapsedPerAan": excluded_extra_dwelling_rows,
        },
        "fanOut": {
            "windowSalesRowsPerAanBeforeLatest": sales_aan_max,
            "eligibleDwellingRowsPerAanBeforeDedupe": dwelling_aan_max,
            "joinedRowsPerAanMax": joined_per_account_max,
        },
        "sourceRows": {
            "sales": sales_source_rows,
            "dwellings": dwelling_source_rows,
        },
        "identityKind": identity_kind,
        "crossSnapshotMatch": cross_snapshot,
        "unmatchedAccountReasons": unmatched_classification["reasons"],
        "styleUnmappedAccountStyles": unmatched_classification["styleUnmappedAccountStyles"],
        "accountKey": {
            "comparison": "string aan on both sides; zero-pad to 8 digits does not redefine the denominator",
            "zeroPadMatchDelta": _zero_pad_match_delta(window_sales["aan"], eligible["aan"]),
        },
    }
    if join_rate < MIN_SALE_TO_DWELLING_JOIN_RATE:
        message = (
            f"Sale->dwelling join rate {join_rate:.1%} is below floor "
            f"{MIN_SALE_TO_DWELLING_JOIN_RATE:.0%}"
        )
        failed_audit = summary_path.with_name("join_audit.json")
        write_bytes_atomically(failed_audit, (json.dumps(join_audit, indent=2) + "\n").encode("utf-8"))
        if strict:
            raise RuntimeError(f"{message}. Measured audit kept at {failed_audit}")
        print(f"WARNING: {message}")

    assessments["aan"] = assessments["aan"].astype(str)
    latest_assessment = (
        assessments.sort_values("tax_year").drop_duplicates("aan", keep="last")[["aan", "assessed_value"]]
    )
    joined = joined.merge(latest_assessment, on="aan", how="left")

    joined["latitude"] = joined["dwellingLatitude"].fillna(joined["y_coord"])
    joined["longitude"] = joined["dwellingLongitude"].fillna(joined["x_coord"])
    joined = joined.dropna(subset=["latitude", "longitude", "timeAdjustmentFactor"])

    joined["salePrice"] = joined["sale_price"].astype(float)
    joined["price"] = joined["salePrice"] * joined["timeAdjustmentFactor"]

    # Leave missing bedrooms null in the extract. Full-data median fill would leak
    # future sales into the feature; the trainer's train-fold imputer owns the fill.
    bedrooms_missing = joined["bedrooms"].isna()
    joined["bedroomsImputed"] = bedrooms_missing

    quality_mask = (
        joined["price"].between(100_000, 10_000_000)
        & joined["livingAreaSqft"].between(250, 10_000)
        & (joined["bedrooms"].isna() | joined["bedrooms"].between(1, 10))
        & joined["bathrooms"].between(1, 10)
    )
    clean = joined[quality_mask].copy()
    dropped_zero_baths = int((joined["bathrooms"] < 1).sum())
    dropped_zero_beds = int((joined["bedrooms"].notna() & (joined["bedrooms"] < 1)).sum())

    postal_codes, postal_match_rate = _assign_postal_codes(clean, civic)
    clean["postalCode"] = postal_codes
    clean["postalFsa"] = clean["postalCode"].str[:3]
    null_postal_rows = int(clean["postalCode"].isna().sum())
    if null_postal_rows:
        print(
            f"WARNING: Excluding {null_postal_rows:,} rows with null postalCode "
            f"(postal bridge match > {POSTAL_MATCH_MAX_METERS:.0f} m)."
        )
    # Policy: drop unmatched postals from training. Strict mode gates on match-rate
    # floor below, not on the existence of droppable orphans.
    clean = clean[clean["postalCode"].notna()].copy()
    if postal_match_rate < 0.95:
        message = f"Postal match rate {postal_match_rate:.1%} is below 95% floor"
        if strict:
            raise RuntimeError(message)
        print(f"WARNING: {message}")

    # Do not bake full-data KMeans labels into the extract. Training refits clusters
    # on the temporal train fold only; warehouse keeps a stable placeholder column.
    clean["submarketCluster"] = "unassigned"
    clean["h3Cell"] = [
        _h3_cell(latitude, longitude) for latitude, longitude in zip(clean["latitude"], clean["longitude"])
    ]

    resolved_reference_date = _resolve_reference_date(reference_date, strict)
    current_year = datetime.fromisoformat(resolved_reference_date).year
    clean["ageYears"] = current_year - pd.to_numeric(clean["yearBuilt"], errors="coerce")
    # year_built corruption (e.g. age 466) → null; train-fold impute later
    clean.loc[clean["ageYears"].notna() & ((clean["ageYears"] < 0) | (clean["ageYears"] > MAX_AGE_YEARS)), "ageYears"] = np.nan
    assessed = pd.to_numeric(clean.get("assessed_value"), errors="coerce")
    price_to_assessed = clean["price"] / assessed.replace(0, np.nan)
    assessed_outlier_mask = assessed.notna() & ((price_to_assessed < 0.3) | (price_to_assessed > 3.0))
    dropped_assessed_outliers = int(assessed_outlier_mask.sum())
    clean = clean.loc[~assessed_outlier_mask].copy()

    clean["logPrice"] = np.log(clean["price"])
    clean["pricePerSqft"] = clean["price"] / clean["livingAreaSqft"]
    clean["lat_x_lon"] = clean["latitude"] * clean["longitude"]
    clean["lat_sq"] = clean["latitude"] ** 2
    clean["lon_sq"] = clean["longitude"] ** 2
    clean["propertyTax"] = np.nan
    clean["saleDate"] = clean["sale_date"].dt.date.astype(str)

    export_columns = [
        "price",
        "logPrice",
        "pricePerSqft",
        "propertyType",
        "postalCode",
        "postalFsa",
        "submarketCluster",
        "livingAreaSqft",
        "bedrooms",
        "bathrooms",
        "latitude",
        "longitude",
        "lat_x_lon",
        "lat_sq",
        "lon_sq",
        "propertyTax",
        "ageYears",
        "h3Cell",
        "assessedValue",
        "salePrice",
        "saleDate",
        "timeAdjustmentFactor",
        "bedroomsImputed",
        "accountId",
        "saleObservationId",
        "identityKind",
        "crossSnapshotMatch",
    ]
    extract = clean.rename(columns={"assessed_value": "assessedValue"})[export_columns].reset_index(drop=True)

    _write_frame_atomically(extract, output_path)

    summary = {
        "market": "halifax_maritimes",
        "targetName": "sale_price_time_adjusted",
        "trainingWindowStart": TRAINING_WINDOW_START,
        "timeAdjustmentBaselineMonth": index_latest_month,
        "referenceDate": resolved_reference_date,
        "rows": {
            "windowSales": join_denominator,
            "joinedToDwellingsBeforeCoordinateFilter": join_numerator,
            "joinedToDwellings": int(len(joined)),
            "cleanTrainingRows": int(len(extract)),
            "styleExcluded": style_excluded,
            "droppedNullPostal": null_postal_rows,
            "droppedZeroBathrooms": dropped_zero_baths,
            "droppedZeroBedrooms": dropped_zero_beds,
            "droppedAssessedOutliers": dropped_assessed_outliers,
            "ageYearsNulledOverMax": int(
                (current_year - pd.to_numeric(joined["yearBuilt"], errors="coerce") > MAX_AGE_YEARS).sum()
            ),
            "bedroomsMissingLeftNull": int(extract["bedrooms"].isna().sum()),
        },
        "rates": {
            "saleToDwellingJoin": round(join_rate, 4),
            "saleToDwellingJoinNumerator": join_numerator,
            "saleToDwellingJoinDenominator": join_denominator,
            "saleToDwellingJoinNumeratorName": join_numerator_name,
            "saleToDwellingJoinDenominatorName": join_denominator_name,
            "saleToDwellingJoinAcceptanceThreshold": MIN_SALE_TO_DWELLING_JOIN_RATE,
            "postalMatchWithin150m": round(postal_match_rate, 4),
            "bedroomsMissing": round(float(extract["bedrooms"].isna().mean()), 4),
            "bedroomsImputed": 0.0,
            "assessedValuePresent": round(float(extract["assessedValue"].notna().mean()), 4),
        },
        "cleaningPolicy": {
            "minBathrooms": 1,
            "minBedroomsWhenPresent": 1,
            "maxAgeYears": MAX_AGE_YEARS,
            "priceToAssessedRange": [0.3, 3.0],
            "submarketCluster": "unassigned-placeholder; refit on train fold at training time",
            "bedroomsMissing": "left-null-for-train-fold-imputer",
        },
        "propertyTypeCounts": extract["propertyType"].value_counts().to_dict(),
        "sources": {
            "dwellings": _source_snapshot(dwellings_path),
            "sales": _source_snapshot(sales_path),
            "assessments": _source_snapshot(assessments_path),
            "civicAddresses": _source_snapshot(civic_addresses_path),
        },
        "identity": {
            "account": "aan",
            "saleObservation": identity_kind,
            "crossSnapshotMatch": cross_snapshot,
            "aanIsUniqueInRawSales": False,
            "trainingGrain": "latest sale per aan inside the training window",
            "stableTransactionIdInSourceSchema": identity_kind == "source:sale_transaction_id",
        },
        "joinAudit": join_audit,
    }
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    write_bytes_atomically(summary_path, (json.dumps(summary, indent=2) + "\n").encode("utf-8"))

    print(f"Wrote {len(extract):,} Halifax training rows to {output_path}")
    print(f"Wrote summary to {summary_path}")
    print(f"Sale->dwelling join rate: {join_rate:.1%}; postal match rate: {postal_match_rate:.1%}")
    return summary


def check_files() -> bool:
    paths = {
        "PVSC residential dwelling characteristics": _path(DEFAULT_DWELLINGS_PATH),
        "PVSC parcel sales history": _path(DEFAULT_SALES_PATH),
        "PVSC assessed values": _path(DEFAULT_ASSESSMENTS_PATH),
        "HRM civic addresses": _path(DEFAULT_CIVIC_ADDRESSES_PATH),
        "HRM building permits": _path(DEFAULT_PERMITS_PATH),
    }
    ready = True
    print("\nHalifax raw data files:")
    for label, path in paths.items():
        exists = path.exists() and path.is_file()
        ready = ready and exists
        status = "found" if exists else "missing"
        print(f"- {label}: {status} ({path})")
    return ready


def main() -> int:
    parser = argparse.ArgumentParser(description="Download and validate the Halifax (HRM) open datasets.")
    parser.add_argument("--download-pvsc", action="store_true", help="Download the PVSC datazONE extracts for HRM.")
    parser.add_argument("--download-hrm", action="store_true", help="Download the HRM civic address and permit layers.")
    parser.add_argument(
        "--record-arcgis-source-updates",
        action="store_true",
        help="Read FeatureServer editingInfo.dataLastEditDate into the acquisition manifest when that file exists.",
    )
    parser.add_argument("--build-training", action="store_true", help="Build the processed Halifax training extract.")
    parser.add_argument("--check", action="store_true", help="Report which raw files are present.")
    parser.add_argument(
        "--strict",
        action=argparse.BooleanOptionalAction,
        default=strict_from_env(False),
        help="Fail on measured join/postal quality gates. CVH_STRICT=0 or 1 overrides the CI default.",
    )
    parser.add_argument(
        "--reference-date",
        default=os.environ.get("CVH_REFERENCE_DATE"),
        help="ISO date used for ageYears. Required when --strict is set.",
    )
    args = parser.parse_args()

    if args.download_pvsc:
        download_pvsc()
    if args.download_hrm:
        download_hrm()
    elif args.record_arcgis_source_updates:
        record_arcgis_source_updates()
    if args.build_training:
        build_training_extract(strict=args.strict, reference_date=args.reference_date)
        return 0

    return 0 if check_files() else 1


if __name__ == "__main__":
    raise SystemExit(main())
