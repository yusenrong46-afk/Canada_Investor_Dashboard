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
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from service import PROPERTY_TYPES, _parse_numeric, estimate_property

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = Path(__file__).resolve().parent / "models"
UPLIFT_ARTIFACT_PATH = ARTIFACT_DIR / "seattle_observed_uplift_bundle_v2.pkl"

UPLIFT_MODEL_VERSION = "seattle-observed-percent-uplift-v2"
UPLIFT_TRAINING_MODE = "seattle-repeat-sale-observed-only"

SEATTLE_DATA_DIR = REPO_ROOT / "data" / "raw" / "seattle"
DEFAULT_PERMITS_PATH = os.environ.get("SEATTLE_PERMITS_PATH", str(SEATTLE_DATA_DIR / "building_permits.csv"))
DEFAULT_SALES_PATH = os.environ.get("KING_COUNTY_SALES_PATH", str(SEATTLE_DATA_DIR / "rpsale_extr.csv"))
DEFAULT_BUILDINGS_PATH = os.environ.get("KING_COUNTY_BUILDINGS_PATH", str(SEATTLE_DATA_DIR / "resbldg_extr.csv"))

MIN_REPEAT_SALE_ROWS = int(os.environ.get("SEATTLE_UPLIFT_MIN_ROWS", "40"))
PRE_SALE_MAX_DAYS = 3650
POST_SALE_MIN_DAYS = 90
POST_SALE_MAX_DAYS = 730
MIN_SALE_PRICE = 50_000
MIN_MARKET_ROWS = 25
MIN_UPLIFT_PERCENT = -0.45
MAX_UPLIFT_PERCENT = 0.85

NUMERIC_FEATURES = [
    "livingAreaSqft",
    "bedrooms",
    "bathrooms",
    "ageAtPermit",
    "projectCostRatio",
    "horizonMonths",
]
CATEGORICAL_FEATURES = ["propertyType"]

IMPROVEMENT_CATALOG: dict[str, dict[str, Any]] = {
    "renovatedKitchen": {
        "label": "Renovated kitchen",
        "defaultCost": 65_000,
        "months": 2,
        "phase": "Interior",
        "keywords": ["kitchen", "cabinet", "counter", "appliance", "range hood"],
    },
    "renovatedBathrooms": {
        "label": "Renovated bathrooms",
        "defaultCost": 35_000,
        "months": 2,
        "phase": "Interior",
        "keywords": ["bathroom", "bath room", "shower", "tub", "fixture", "plumbing"],
    },
    "legalSuiteAdded": {
        "label": "Legal suite added",
        "defaultCost": 90_000,
        "months": 4,
        "phase": "Income",
        "keywords": ["adu", "dadu", "accessory dwelling", "basement unit", "mother in law", "second unit"],
    },
    "energyEfficient": {
        "label": "Energy upgrades",
        "defaultCost": 22_000,
        "months": 2,
        "phase": "Efficiency",
        "keywords": ["heat pump", "hvac", "insulation", "window", "solar", "energy"],
    },
    "deferredMaintenanceResolved": {
        "label": "Deferred maintenance resolved",
        "defaultCost": 28_000,
        "months": 2,
        "phase": "Readiness",
        "keywords": ["repair", "replace", "structural", "foundation", "drainage", "water damage"],
    },
    "roofIssueResolved": {
        "label": "Roof and systems resolved",
        "defaultCost": 24_000,
        "months": 1,
        "phase": "Readiness",
        "keywords": ["roof", "reroof", "roofing", "furnace", "boiler", "electrical panel", "rewire"],
    },
}

FLAG_FEATURES = list(IMPROVEMENT_CATALOG.keys())

BAD_SALE_WARNING_CODES = {
    "10",  # tear down
    "14",  # sheriff / tax sale
    "15",  # no market exposure
    "23",  # forced sale
    "31",  # exempt from excise tax
    "32",  # very low sale amount
    "45",  # multi-parcel sale
    "46",  # non-representative sale
    "51",  # related party
    "54",  # affordable housing sale
    "56",  # builder/developer sale
    "59",  # bulk portfolio sale
    "60",  # short sale
    "61",  # financial institution resale
    "62",  # auction sale
}
BAD_SALE_REASONS = {"4", "8", "10", "11", "12", "14", "15", "17", "18"}


@dataclass(frozen=True)
class UpliftDataPaths:
    permits: Path
    sales: Path
    buildings: Path


@dataclass
class UpliftModelBundle:
    ready: bool
    message: str
    model_version: str
    training_mode: str
    trained_at: str
    data_sources: dict[str, str]
    row_counts: dict[str, int]
    model: Pipeline | None
    confidence_error: float
    evaluation_summary: dict[str, Any]
    available_flags: list[str]


_UPLIFT_BUNDLE: UpliftModelBundle | None = None


def _safe_ohe() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def _data_paths() -> UpliftDataPaths:
    return UpliftDataPaths(
        permits=Path(DEFAULT_PERMITS_PATH).expanduser(),
        sales=Path(DEFAULT_SALES_PATH).expanduser(),
        buildings=Path(DEFAULT_BUILDINGS_PATH).expanduser(),
    )


def _data_sources(paths: UpliftDataPaths) -> dict[str, str]:
    return {
        "seattlePermits": str(paths.permits),
        "kingCountySales": str(paths.sales),
        "kingCountyResidentialBuildings": str(paths.buildings),
    }


def _missing_bundle(message: str, paths: UpliftDataPaths, row_counts: dict[str, int] | None = None) -> UpliftModelBundle:
    return UpliftModelBundle(
        ready=False,
        message=message,
        model_version=UPLIFT_MODEL_VERSION,
        training_mode=UPLIFT_TRAINING_MODE,
        trained_at="",
        data_sources=_data_sources(paths),
        row_counts=row_counts or {"permitRows": 0, "saleRows": 0, "buildingRows": 0, "repeatSaleRows": 0},
        model=None,
        confidence_error=0.0,
        evaluation_summary={"message": message},
        available_flags=FLAG_FEATURES,
    )


def require_real_csv(path: str | Path, label: str) -> Path:
    csv_path = Path(path).expanduser()
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Missing real {label} CSV at {csv_path}. Add the file locally or set the matching environment variable."
        )
    if not csv_path.is_file():
        raise FileNotFoundError(f"The configured real {label} CSV path is not a file: {csv_path}")
    return csv_path


def _read_real_csv(path: str | Path, label: str) -> pd.DataFrame:
    csv_path = require_real_csv(path, label)
    try:
        frame = pd.read_csv(csv_path, low_memory=False)
    except UnicodeDecodeError:
        frame = pd.read_csv(csv_path, low_memory=False, encoding="latin1")
    if frame.empty:
        raise ValueError(f"The real {label} CSV is empty: {csv_path}")
    return frame


def _clean_column_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _find_column(frame: pd.DataFrame, aliases: list[str], required: bool = True) -> str | None:
    columns = {_clean_column_name(str(column)): str(column) for column in frame.columns}
    for alias in aliases:
        column = columns.get(_clean_column_name(alias))
        if column:
            return column
    if required:
        raise ValueError(f"Missing required column. Expected one of: {', '.join(aliases)}")
    return None


def _optional_series(frame: pd.DataFrame, column: str | None) -> pd.Series:
    if column and column in frame.columns:
        return frame[column]
    return pd.Series([None] * len(frame), index=frame.index)


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(value, float) and math.isnan(value):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _normalize_pin(value: Any) -> str | None:
    text = _normalize_text(value)
    if not text:
        return None
    text = re.sub(r"\.0$", "", text)
    digits = re.sub(r"\D", "", text)
    if digits:
        return digits.zfill(10)[-10:]
    return re.sub(r"[^A-Z0-9]", "", text.upper()) or None


def _pin_from_major_minor(major: Any, minor: Any) -> str | None:
    major_text = re.sub(r"\D", "", _normalize_text(major))
    minor_text = re.sub(r"\D", "", _normalize_text(minor))
    if not major_text or not minor_text:
        return None
    return f"{major_text.zfill(6)[-6:]}{minor_text.zfill(4)[-4:]}"


def _normalize_zip(value: Any) -> str | None:
    text = _normalize_text(value)
    matches = re.findall(r"\d{5}(?:-\d{4})?", text)
    if not matches:
        return None
    return matches[-1][:5]


def _parse_date(value: Any) -> pd.Timestamp | pd.NaT:
    text = _normalize_text(value)
    if not text:
        return pd.NaT
    text = re.sub(r"\.0$", "", text)
    digits = re.sub(r"\D", "", text)
    if re.fullmatch(r"\d{8}", digits):
        ymd = pd.to_datetime(digits, format="%Y%m%d", errors="coerce")
        if pd.notna(ymd):
            return ymd
        mdy = pd.to_datetime(digits, format="%m%d%Y", errors="coerce")
        if pd.notna(mdy):
            return mdy
    return pd.to_datetime(text, errors="coerce")


def _normalize_address(value: Any) -> str | None:
    text = _normalize_text(value).upper()
    if not text:
        return None

    text = text.split(",")[0]
    text = re.sub(r"\s+\d{5}(?:-\d{4})?\s*$", " ", text)
    text = re.sub(r"#\s*\w+", " ", text)
    text = re.sub(r"\b(APT|UNIT|STE|SUITE|ROOM|RM)\s+\w+\b", " ", text)
    text = re.sub(r"[^A-Z0-9 ]", " ", text)
    replacements = {
        "NORTH": "N",
        "SOUTH": "S",
        "EAST": "E",
        "WEST": "W",
        "NORTHEAST": "NE",
        "NORTHWEST": "NW",
        "SOUTHEAST": "SE",
        "SOUTHWEST": "SW",
        "STREET": "ST",
        "AVENUE": "AVE",
        "BOULEVARD": "BLVD",
        "DRIVE": "DR",
        "ROAD": "RD",
        "PLACE": "PL",
        "COURT": "CT",
        "LANE": "LN",
        "TERRACE": "TER",
    }
    parts = [replacements.get(part, part) for part in text.split()]
    normalized = " ".join(parts)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized or None


def _extract_flag_map(text: str) -> dict[str, int]:
    lowered = text.lower()
    flags = {flag: 0 for flag in FLAG_FEATURES}
    for flag, item in IMPROVEMENT_CATALOG.items():
        if any(keyword in lowered for keyword in item["keywords"]):
            flags[flag] = 1
    return flags


def _infer_property_type(text: str = "", living_units: Any = None) -> str:
    lowered = text.lower()
    units = _parse_numeric(living_units)
    if "condo" in lowered or "apartment" in lowered:
        return "Condo"
    if "townhouse" in lowered or "townhome" in lowered or "rowhouse" in lowered or "row house" in lowered:
        return "Townhouse"
    if "duplex" in lowered or units == 2:
        return "Duplex"
    return "Detached"


def _has_bad_warning(value: Any) -> bool:
    codes = set(re.findall(r"\d+", _normalize_text(value)))
    return bool(codes & BAD_SALE_WARNING_CODES)


def _is_real_renovation_permit(text: str, permit_class: str) -> bool:
    lowered = text.lower()
    class_lower = permit_class.lower()

    if "commercial" in class_lower and "residential" not in class_lower:
        return False
    if "industrial" in class_lower or "institutional" in class_lower:
        return False

    if "demolition" in lowered or "demolish" in lowered:
        return False
    if ("new construction" in lowered or "construct new" in lowered or "new building" in lowered) and "addition" not in lowered:
        return False

    work_words = ["addition", "alteration", "remodel", "renovation", "repair", "replace", "reroof", "change use"]
    return any(word in lowered for word in work_words)


def load_permits(path: str | Path = DEFAULT_PERMITS_PATH) -> pd.DataFrame:
    permits = _read_real_csv(path, "Seattle building permits")
    permits.columns = [str(column).strip() for column in permits.columns]

    permit_id_col = _find_column(permits, ["permitnum", "permitnumber", "permit_number", "permit number"], required=False)
    date_col = _find_column(permits, ["issueddate", "issued_date", "issue_date", "issuedate", "finaldate", "completeddate", "applicationdate"])
    value_col = _find_column(permits, ["value", "projectvalue", "project_value", "estimatedprojectcost", "estprojectcost"], required=False)
    address_col = _find_column(permits, ["originaladdress1", "address", "siteaddress", "propertyaddress", "addressline"], required=False)
    zip_col = _find_column(permits, ["originalzip", "zip", "zipcode", "postalcode"], required=False)
    class_col = _find_column(permits, ["permitclassmapped", "permitclass", "permit_class", "category", "permitcategory"], required=False)
    type_col = _find_column(permits, ["permittype", "permittypedesc", "worktype", "type"], required=False)
    desc_col = _find_column(permits, ["description", "projectdescription", "scopeofwork", "comments"], required=False)
    pin_col = _find_column(permits, ["pin", "apn", "parcel", "parcelnumber", "propertyid"], required=False)

    out = pd.DataFrame(
        {
            "permitId": _optional_series(permits, permit_id_col).map(_normalize_text),
            "permitDate": _optional_series(permits, date_col).map(_parse_date),
            "permitValue": _optional_series(permits, value_col).map(_parse_numeric),
            "normalizedAddress": _optional_series(permits, address_col).map(_normalize_address),
            "zipCode": _optional_series(permits, zip_col).map(_normalize_zip),
            "permitClass": _optional_series(permits, class_col).map(_normalize_text),
            "permitType": _optional_series(permits, type_col).map(_normalize_text),
            "description": _optional_series(permits, desc_col).map(_normalize_text),
            "pin": _optional_series(permits, pin_col).map(_normalize_pin),
        }
    )
    out["combinedText"] = (out["permitClass"] + " " + out["permitType"] + " " + out["description"]).str.strip()

    flag_rows = out["combinedText"].map(_extract_flag_map)
    for flag in FLAG_FEATURES:
        out[flag] = [row[flag] for row in flag_rows]

    out["propertyType"] = [_infer_property_type(text) for text in out["combinedText"]]
    real_renovation_mask = pd.Series(
        [_is_real_renovation_permit(text, permit_class) for text, permit_class in zip(out["combinedText"], out["permitClass"])],
        index=out.index,
    )
    mask = (
        out["permitDate"].notna()
        & (out["pin"].notna() | out["normalizedAddress"].notna())
        & out[FLAG_FEATURES].sum(axis=1).gt(0)
        & real_renovation_mask
    )
    out = out.loc[mask].copy()
    out["permitRowId"] = np.arange(len(out))
    return out


def load_sales(path: str | Path = DEFAULT_SALES_PATH) -> pd.DataFrame:
    sales = _read_real_csv(path, "King County sales")
    sales.columns = [str(column).strip() for column in sales.columns]

    pin_col = _find_column(sales, ["pin"], required=False)
    major_col = _find_column(sales, ["major"], required=False)
    minor_col = _find_column(sales, ["minor"], required=False)
    date_col = _find_column(sales, ["saledate", "sale_date", "sale date", "documentdate", "document_date", "document date"])
    price_col = _find_column(sales, ["saleprice", "sale_price", "sale price"])
    property_class_col = _find_column(sales, ["propertyclass", "property_class"], required=False)
    principal_use_col = _find_column(sales, ["principaluse", "principal_use"], required=False)
    property_type_col = _find_column(sales, ["propertytype", "property_type"], required=False)
    sale_reason_col = _find_column(sales, ["salereason", "sale_reason"], required=False)
    sale_warning_col = _find_column(sales, ["salewarning", "sale_warning"], required=False)

    if pin_col:
        pins = sales[pin_col].map(_normalize_pin)
    elif major_col and minor_col:
        pins = [_pin_from_major_minor(major, minor) for major, minor in zip(sales[major_col], sales[minor_col])]
    else:
        raise ValueError("King County sales CSV needs PIN, or MAJOR and MINOR columns.")

    out = pd.DataFrame(
        {
            "pin": pins,
            "saleDate": sales[date_col].map(_parse_date),
            "salePrice": sales[price_col].map(_parse_numeric),
            "propertyClass": _optional_series(sales, property_class_col).map(_normalize_text),
            "principalUse": _optional_series(sales, principal_use_col).map(_normalize_text),
            "propertyTypeRaw": _optional_series(sales, property_type_col).map(_normalize_text),
            "saleReason": _optional_series(sales, sale_reason_col).map(_normalize_text),
            "saleWarning": _optional_series(sales, sale_warning_col).map(_normalize_text),
        }
    )
    out["propertyType"] = [_infer_property_type(text) for text in out["propertyTypeRaw"]]
    out["saleReasonCode"] = out["saleReason"].str.extract(r"(\d+)")[0].fillna("")

    residential_mask = out["principalUse"].isin(["", "2", "6"]) | out["propertyClass"].isin(["8", "9"])
    good_sale_mask = (
        out["pin"].notna()
        & out["saleDate"].notna()
        & out["salePrice"].gt(MIN_SALE_PRICE)
        & residential_mask
        & ~out["saleWarning"].map(_has_bad_warning)
        & ~out["saleReasonCode"].isin(BAD_SALE_REASONS)
    )
    return out.loc[good_sale_mask].sort_values(["pin", "saleDate"]).copy()


def load_buildings(path: str | Path = DEFAULT_BUILDINGS_PATH) -> pd.DataFrame:
    buildings = _read_real_csv(path, "King County residential buildings")
    buildings.columns = [str(column).strip() for column in buildings.columns]

    pin_col = _find_column(buildings, ["pin"], required=False)
    major_col = _find_column(buildings, ["major"], required=False)
    minor_col = _find_column(buildings, ["minor"], required=False)
    address_col = _find_column(buildings, ["situsaddress", "address", "siteaddress"], required=False)
    zip_col = _find_column(buildings, ["zipcode", "zip", "postalcode"], required=False)
    living_col = _find_column(buildings, ["sqfttotliving", "total_living_area", "living_area_sqft"], required=False)
    bedrooms_col = _find_column(buildings, ["bedrooms"], required=False)
    full_bath_col = _find_column(buildings, ["bathfullcount", "full_baths"], required=False)
    threeq_bath_col = _find_column(buildings, ["bath3qtrcount", "three_quarter_baths"], required=False)
    half_bath_col = _find_column(buildings, ["bathhalfcount", "half_baths"], required=False)
    year_built_col = _find_column(buildings, ["yrbuilt", "yearbuilt", "year_built"], required=False)
    units_col = _find_column(buildings, ["nbrlivingunits", "living_units"], required=False)

    if pin_col:
        pins = buildings[pin_col].map(_normalize_pin)
    elif major_col and minor_col:
        pins = [_pin_from_major_minor(major, minor) for major, minor in zip(buildings[major_col], buildings[minor_col])]
    else:
        raise ValueError("King County residential buildings CSV needs PIN, or MAJOR and MINOR columns.")

    raw_address = _optional_series(buildings, address_col).map(_normalize_text)
    out = pd.DataFrame(
        {
            "pin": pins,
            "normalizedAddress": raw_address.map(_normalize_address),
            "zipCode": _optional_series(buildings, zip_col).map(_normalize_zip),
            "livingAreaSqft": _optional_series(buildings, living_col).map(_parse_numeric),
            "bedrooms": _optional_series(buildings, bedrooms_col).map(_parse_numeric),
            "fullBaths": _optional_series(buildings, full_bath_col).map(_parse_numeric),
            "threeQuarterBaths": _optional_series(buildings, threeq_bath_col).map(_parse_numeric),
            "halfBaths": _optional_series(buildings, half_bath_col).map(_parse_numeric),
            "yearBuilt": _optional_series(buildings, year_built_col).map(_parse_numeric),
            "livingUnits": _optional_series(buildings, units_col).map(_parse_numeric),
        }
    )
    missing_zip = out["zipCode"].isna()
    out.loc[missing_zip, "zipCode"] = raw_address.loc[missing_zip].map(_normalize_zip)
    out["bathrooms"] = out["fullBaths"].fillna(0) + (out["threeQuarterBaths"].fillna(0) * 0.75) + (out["halfBaths"].fillna(0) * 0.5)
    out["propertyType"] = [_infer_property_type("", units) for units in out["livingUnits"]]

    out = out.loc[out["pin"].notna()].copy()
    grouped = (
        out.sort_values("livingAreaSqft", ascending=False)
        .groupby("pin", as_index=False)
        .agg(
            {
                "normalizedAddress": "first",
                "zipCode": "first",
                "livingAreaSqft": "sum",
                "bedrooms": "sum",
                "bathrooms": "sum",
                "yearBuilt": "min",
                "livingUnits": "sum",
                "propertyType": "first",
            }
        )
    )
    grouped["propertyType"] = [_infer_property_type("", units) for units in grouped["livingUnits"]]
    return grouped


def _join_permits_to_buildings(permits: pd.DataFrame, buildings: pd.DataFrame) -> pd.DataFrame:
    direct = permits.loc[permits["pin"].notna()].merge(buildings, on="pin", how="inner", suffixes=("", "Building"))

    unmatched_ids = set(permits["permitRowId"]) - set(direct["permitRowId"])
    address_candidates = permits.loc[permits["permitRowId"].isin(unmatched_ids) & permits["normalizedAddress"].notna()].copy()
    address_join = address_candidates.merge(
        buildings,
        on=["normalizedAddress", "zipCode"],
        how="inner",
        suffixes=("", "Building"),
    )

    joined = pd.concat([direct, address_join], ignore_index=True)
    if "pinBuilding" in joined.columns:
        joined["pin"] = joined["pin"].where(joined["pin"].notna(), joined["pinBuilding"])
    joined = joined.drop_duplicates(["permitRowId", "pin"])
    joined["propertyType"] = joined["propertyTypeBuilding"].where(joined["propertyTypeBuilding"].isin(PROPERTY_TYPES), joined["propertyType"])
    return joined


def _quarter_value(series: pd.Series, date: pd.Timestamp) -> float | None:
    if series.empty or pd.isna(date):
        return None
    target = date.to_period("Q")
    if target in series.index:
        value = series.loc[target]
        return float(value) if pd.notna(value) and value > 0 else None

    distances = [abs(period.ordinal - target.ordinal) for period in series.index]
    nearest = series.index[int(np.argmin(distances))]
    value = series.loc[nearest]
    return float(value) if pd.notna(value) and value > 0 else None


def _quarter_market_series(sales: pd.DataFrame) -> pd.Series:
    return sales.groupby(sales["saleDate"].dt.to_period("Q"))["salePrice"].median().sort_index()


def _market_factor_from_series(by_quarter: pd.Series, earlier: pd.Timestamp, later: pd.Timestamp) -> float | None:
    if len(by_quarter) < 2:
        return None

    earlier_value = _quarter_value(by_quarter, earlier)
    later_value = _quarter_value(by_quarter, later)
    if earlier_value is None or later_value is None or earlier_value <= 0:
        return None

    factor = later_value / earlier_value
    if not np.isfinite(factor) or factor < 0.5 or factor > 2.0:
        return None
    return float(factor)


def estimate_market_factor(sales: pd.DataFrame, property_type: str, earlier: pd.Timestamp, later: pd.Timestamp) -> float | None:
    subset = sales.loc[sales["propertyType"].eq(property_type)].copy()
    if len(subset) < MIN_MARKET_ROWS:
        subset = sales.copy()
    if len(subset) < MIN_MARKET_ROWS:
        return None

    return _market_factor_from_series(_quarter_market_series(subset), earlier, later)


def calculate_uplift_percent(previous_price: float, next_price: float, market_factor: float) -> float:
    expected_next_price = previous_price * market_factor
    if expected_next_price <= 0:
        raise ValueError("expected_next_price must be positive")
    return float((next_price - expected_next_price) / expected_next_price)


def build_repeat_sale_rows(permits: pd.DataFrame, sales: pd.DataFrame, buildings: pd.DataFrame) -> pd.DataFrame:
    joined_permits = _join_permits_to_buildings(permits, buildings)
    sales_by_pin = {pin: frame.sort_values("saleDate") for pin, frame in sales.groupby("pin")}
    all_market_series = _quarter_market_series(sales)
    market_series_by_type = {
        property_type: _quarter_market_series(group)
        for property_type, group in sales.groupby("propertyType")
        if len(group) >= MIN_MARKET_ROWS
    }
    rows: list[dict[str, Any]] = []

    for _, permit in joined_permits.iterrows():
        pin = permit["pin"]
        permit_date = permit["permitDate"]
        if pin not in sales_by_pin or pd.isna(permit_date):
            continue

        sale_group = sales_by_pin[pin]
        prior_sales = sale_group.loc[
            (sale_group["saleDate"] < permit_date)
            & ((permit_date - sale_group["saleDate"]).dt.days <= PRE_SALE_MAX_DAYS)
        ]
        future_sales = sale_group.loc[
            sale_group["saleDate"].between(
                permit_date + pd.Timedelta(days=POST_SALE_MIN_DAYS),
                permit_date + pd.Timedelta(days=POST_SALE_MAX_DAYS),
            )
        ]
        if prior_sales.empty or future_sales.empty:
            continue

        previous_sale = prior_sales.iloc[-1]
        next_sale = future_sales.iloc[0]
        property_type = str(permit.get("propertyType") or previous_sale.get("propertyType") or "Detached")
        if property_type not in PROPERTY_TYPES:
            property_type = "Detached"

        market_series = market_series_by_type.get(property_type, all_market_series)
        market_factor = _market_factor_from_series(market_series, previous_sale["saleDate"], next_sale["saleDate"])
        if market_factor is None:
            continue

        uplift_percent = calculate_uplift_percent(
            float(previous_sale["salePrice"]),
            float(next_sale["salePrice"]),
            market_factor,
        )
        if not np.isfinite(uplift_percent) or uplift_percent < MIN_UPLIFT_PERCENT or uplift_percent > MAX_UPLIFT_PERCENT:
            continue

        permit_value = _parse_numeric(permit.get("permitValue"))
        expected_next_price = float(previous_sale["salePrice"]) * market_factor
        year_built = _parse_numeric(permit.get("yearBuilt"))
        age_at_permit = float(permit_date.year - year_built) if year_built and year_built > 0 else np.nan

        row = {
            "pin": pin,
            "permitId": permit.get("permitId"),
            "permitDate": permit_date,
            "previousSaleDate": previous_sale["saleDate"],
            "nextSaleDate": next_sale["saleDate"],
            "previousSalePrice": float(previous_sale["salePrice"]),
            "nextSalePrice": float(next_sale["salePrice"]),
            "marketFactor": market_factor,
            "upliftPercent": uplift_percent,
            "propertyType": property_type,
            "livingAreaSqft": _parse_numeric(permit.get("livingAreaSqft")),
            "bedrooms": _parse_numeric(permit.get("bedrooms")),
            "bathrooms": _parse_numeric(permit.get("bathrooms")),
            "ageAtPermit": age_at_permit,
            "projectCostRatio": (permit_value / expected_next_price) if permit_value and expected_next_price > 0 else np.nan,
            "horizonMonths": max(1.0, (next_sale["saleDate"] - permit_date).days / 30.4),
        }
        for flag in FLAG_FEATURES:
            row[flag] = int(permit.get(flag) or 0)
        rows.append(row)

    return pd.DataFrame(rows)


def _build_pipeline() -> Pipeline:
    numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    categorical_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", _safe_ohe()),
        ]
    )
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_pipeline, NUMERIC_FEATURES + FLAG_FEATURES),
            ("cat", categorical_pipeline, CATEGORICAL_FEATURES),
        ],
        remainder="drop",
    )
    model = RandomForestRegressor(
        n_estimators=260,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=4,
    )
    return Pipeline([("prep", preprocessor), ("model", model)])


def train_model(rows: pd.DataFrame) -> tuple[Pipeline, dict[str, Any], float]:
    feature_columns = NUMERIC_FEATURES + FLAG_FEATURES + CATEGORICAL_FEATURES
    x = rows[feature_columns].copy()
    y = rows["upliftPercent"].to_numpy(dtype=float)

    train_x, test_x, train_y, test_y = train_test_split(x, y, test_size=0.2, random_state=42)
    pipeline = _build_pipeline()
    pipeline.fit(train_x, train_y)
    predicted = pipeline.predict(test_x)
    mae = float(mean_absolute_error(test_y, predicted))
    evaluation = {
        "trainingRows": int(len(rows)),
        "holdoutRows": int(len(test_y)),
        "holdoutMaePercentPoints": round(mae * 100, 2),
        "holdoutR2": float(r2_score(test_y, predicted)) if len(test_y) > 1 else 0.0,
        "target": "market-adjusted uplift percent from real repeat sales",
    }
    pipeline.fit(x, y)
    return pipeline, evaluation, mae


def _train_uplift_bundle(paths: UpliftDataPaths) -> UpliftModelBundle:
    permits = load_permits(paths.permits)
    sales = load_sales(paths.sales)
    buildings = load_buildings(paths.buildings)
    rows = build_repeat_sale_rows(permits, sales, buildings)
    row_counts = {
        "permitRows": int(len(permits)),
        "saleRows": int(len(sales)),
        "buildingRows": int(len(buildings)),
        "repeatSaleRows": int(len(rows)),
    }

    if len(rows) < MIN_REPEAT_SALE_ROWS:
        return _missing_bundle(
            f"Only {len(rows)} observed Seattle repeat-sale uplift rows were found. Need at least {MIN_REPEAT_SALE_ROWS}.",
            paths,
            row_counts,
        )

    model, evaluation, confidence_error = train_model(rows)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    bundle = UpliftModelBundle(
        ready=True,
        message="Seattle observed repeat-sale uplift model is ready.",
        model_version=UPLIFT_MODEL_VERSION,
        training_mode=UPLIFT_TRAINING_MODE,
        trained_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
        data_sources=_data_sources(paths),
        row_counts=row_counts,
        model=model,
        confidence_error=confidence_error,
        evaluation_summary={
            **evaluation,
            "improvementFlagCoverage": {flag: int(rows[flag].sum()) for flag in FLAG_FEATURES},
            "saleWindow": f"{POST_SALE_MIN_DAYS}-{POST_SALE_MAX_DAYS} days after permit date",
            "noSyntheticData": True,
            "noProxyLabels": True,
        },
        available_flags=FLAG_FEATURES,
    )
    with UPLIFT_ARTIFACT_PATH.open("wb") as artifact_file:
        pickle.dump(bundle, artifact_file)
    return bundle


def _validate_data_files(paths: UpliftDataPaths) -> None:
    require_real_csv(paths.permits, "Seattle building permits")
    require_real_csv(paths.sales, "King County sales")
    require_real_csv(paths.buildings, "King County residential buildings")


def load_uplift_bundle(force_retrain: bool = False) -> UpliftModelBundle:
    global _UPLIFT_BUNDLE
    paths = _data_paths()

    try:
        _validate_data_files(paths)
    except (FileNotFoundError, ValueError) as error:
        _UPLIFT_BUNDLE = _missing_bundle(str(error), paths)
        return _UPLIFT_BUNDLE

    if _UPLIFT_BUNDLE is not None and _UPLIFT_BUNDLE.ready and not force_retrain:
        return _UPLIFT_BUNDLE

    if not force_retrain and UPLIFT_ARTIFACT_PATH.exists():
        try:
            with UPLIFT_ARTIFACT_PATH.open("rb") as artifact_file:
                bundle = pickle.load(artifact_file)
            if isinstance(bundle, UpliftModelBundle) and bundle.model_version == UPLIFT_MODEL_VERSION:
                _UPLIFT_BUNDLE = bundle
                return bundle
        except Exception:
            pass

    try:
        _UPLIFT_BUNDLE = _train_uplift_bundle(paths)
    except (FileNotFoundError, ValueError) as error:
        _UPLIFT_BUNDLE = _missing_bundle(str(error), paths)
    return _UPLIFT_BUNDLE


def _planned_flags(payload: dict[str, Any]) -> list[str]:
    flags: list[str] = []
    for flag in payload.get("plannedFlags", []) or []:
        if flag in IMPROVEMENT_CATALOG and flag not in flags:
            flags.append(flag)
    return flags


def _feature_row(payload: dict[str, Any], base_value: float, planned_flags: list[str], horizon_months: float) -> pd.DataFrame:
    year_built = _parse_numeric(payload.get("yearBuilt"))
    age_at_permit = (datetime.utcnow().year - year_built) if year_built and year_built > 0 else np.nan
    planned_cost = float(sum(IMPROVEMENT_CATALOG[flag]["defaultCost"] for flag in planned_flags))

    row = {
        "livingAreaSqft": _parse_numeric(payload.get("livingAreaSqft")),
        "bedrooms": _parse_numeric(payload.get("bedrooms")),
        "bathrooms": _parse_numeric(payload.get("bathrooms")),
        "ageAtPermit": age_at_permit,
        "projectCostRatio": planned_cost / base_value if base_value > 0 else np.nan,
        "horizonMonths": horizon_months,
        "propertyType": str(payload.get("propertyType") or "Detached"),
    }
    if row["propertyType"] not in PROPERTY_TYPES:
        row["propertyType"] = "Detached"
    for flag in FLAG_FEATURES:
        row[flag] = 1 if flag in planned_flags else 0
    return pd.DataFrame([row])


def _zero_uplift_response(payload: dict[str, Any], base_estimate: dict[str, Any], planned_flags: list[str]) -> dict[str, Any]:
    return {
        "status": "ready",
        "modelVersion": UPLIFT_MODEL_VERSION,
        "trainingMode": UPLIFT_TRAINING_MODE,
        "modelFamily": "random-forest",
        "evidenceLevel": "observed",
        "evidenceSummary": "No selected improvements, so uplift is zero. The trained uplift path uses real Seattle repeat-sale records only.",
        "baseValue": int(base_estimate["baseValue"]),
        "upliftPercent": 0.0,
        "upliftPercentConfidenceLow": 0.0,
        "upliftPercentConfidenceHigh": 0.0,
        "upliftValue": 0,
        "finalValueRaw": int(base_estimate["baseValue"]),
        "finalValueGuardrailed": int(base_estimate["baseValue"]),
        "upliftConfidenceLow": 0,
        "upliftConfidenceHigh": 0,
        "ceilingFlag": False,
        "plannedFlags": planned_flags,
        "topUpliftDrivers": [],
        "observedShare": 1.0,
        "methodNotes": ["No synthetic rows, proxy labels, or rule-based uplift are used."],
    }


def simulate_uplift(payload: dict[str, Any]) -> dict[str, Any]:
    base_estimate = estimate_property(payload)
    planned_flags = _planned_flags(payload)
    if not planned_flags:
        return _zero_uplift_response(payload, base_estimate, planned_flags)

    bundle = load_uplift_bundle(force_retrain=os.environ.get("UPLIFT_FORCE_RETRAIN") == "1")
    if not bundle.ready or bundle.model is None:
        return {
            "status": "data-missing",
            "message": bundle.message,
            "modelVersion": bundle.model_version,
            "trainingMode": bundle.training_mode,
            "evidenceLevel": "observed",
            "dataSources": bundle.data_sources,
            "rowCounts": bundle.row_counts,
            "methodNotes": ["The uplift model refuses to train without real Seattle permits, real King County sales, and real building records."],
        }

    base_value = float(base_estimate["baseValue"])
    horizon_months = float(np.clip(_parse_numeric(payload.get("horizonMonths")) or 9.0, 3.0, 18.0))
    feature_frame = _feature_row(payload, base_value, planned_flags, horizon_months)
    uplift_percent = float(bundle.model.predict(feature_frame)[0])

    confidence_error = max(float(bundle.confidence_error), 0.015)
    low_percent = uplift_percent - confidence_error
    high_percent = uplift_percent + confidence_error
    uplift_value = round(base_value * uplift_percent)
    low_value = round(base_value * low_percent)
    high_value = round(base_value * high_percent)

    driver_rows: list[dict[str, Any]] = []
    for flag in planned_flags:
        single_frame = _feature_row(payload, base_value, [flag], horizon_months)
        single_percent = float(bundle.model.predict(single_frame)[0])
        driver_rows.append(
            {
                "flag": flag,
                "label": IMPROVEMENT_CATALOG[flag]["label"],
                "value": round(base_value * single_percent),
                "upliftPercent": round(single_percent, 4),
            }
        )

    final_value_raw = round(base_value + uplift_value)
    practical_ceiling = int(base_estimate["marketContext"]["practicalCeiling"])
    final_value_guardrailed = min(final_value_raw, practical_ceiling)

    return {
        "status": "ready",
        "modelVersion": bundle.model_version,
        "trainingMode": bundle.training_mode,
        "modelFamily": "random-forest",
        "evidenceLevel": "observed",
        "evidenceSummary": "Seattle-trained observed repeat-sale uplift percentage, applied to the Vancouver base estimate.",
        "baseValue": int(base_value),
        "upliftPercent": round(uplift_percent, 4),
        "upliftPercentConfidenceLow": round(low_percent, 4),
        "upliftPercentConfidenceHigh": round(high_percent, 4),
        "upliftValue": int(uplift_value),
        "finalValueRaw": int(final_value_raw),
        "finalValueGuardrailed": int(final_value_guardrailed),
        "upliftConfidenceLow": int(low_value),
        "upliftConfidenceHigh": int(high_value),
        "ceilingFlag": final_value_raw > practical_ceiling,
        "plannedFlags": planned_flags,
        "topUpliftDrivers": sorted(driver_rows, key=lambda item: abs(item["value"]), reverse=True),
        "observedShare": 1.0,
        "dataSources": bundle.data_sources,
        "rowCounts": bundle.row_counts,
        "methodNotes": ["No synthetic rows, proxy labels, or rule-based uplift are used."],
    }


def uplift_health_payload() -> dict[str, Any]:
    bundle = load_uplift_bundle()
    return {
        "ready": bundle.ready,
        "message": bundle.message,
        "modelVersion": bundle.model_version,
        "trainingMode": bundle.training_mode,
        "trainedAt": bundle.trained_at,
        "rowCounts": bundle.row_counts,
        "modelFamily": "random-forest" if bundle.ready else None,
        "evaluationSummary": bundle.evaluation_summary,
        "evidenceLevel": "observed",
        "observedShare": 1.0 if bundle.ready else 0.0,
        "dataSources": bundle.data_sources,
        "availableFlags": bundle.available_flags,
    }
