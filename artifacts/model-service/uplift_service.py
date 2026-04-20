from __future__ import annotations

import math
import os
import pickle
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import numpy as np
import pandas as pd
from sklearn.base import clone
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

from service import (
    PROPERTY_TYPES,
    _format_postal_code,
    _location_feature_payload,
    _normalize_postal_code,
    _parse_numeric,
    _resolve_centroid,
    estimate_property,
    load_bundle,
)

ARTIFACT_DIR = Path(__file__).resolve().parent / "models"
UPLIFT_ARTIFACT_PATH = ARTIFACT_DIR / "vancouver_uplift_bundle_v1.pkl"
UPLIFT_MODEL_VERSION = "vancouver-uplift-hybrid-v1"
UPLIFT_TRAINING_MODE = "vancouver-open-proxy-plus-optional-observed"
DEFAULT_CITY_PERMITS_PATH = os.environ.get(
    "VANCOUVER_CITY_PERMITS_PATH",
    "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/issued-building-permits/exports/csv?select=permitnumber%2Cissuedate%2Cissueyear%2Cpermitelapseddays%2Cprojectvalue%2Ctypeofwork%2Caddress%2Cprojectdescription%2Cpermitcategory%2Cpropertyuse%2Cspecificusecategory%2Cgeolocalarea%2Cgeo_point_2d",
)
DEFAULT_PROPERTY_TAX_PATH = os.environ.get(
    "VANCOUVER_PROPERTY_TAX_PATH",
    "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-tax-report/exports/csv?select=report_year%2Ctax_assessment_year%2Ccurrent_land_value%2Ccurrent_improvement_value%2Cprevious_land_value%2Cprevious_improvement_value%2Ctax_levy%2Cyear_built%2Cbig_improvement_year%2Cproperty_postal_code%2Cfrom_civic_number%2Cstreet_name%2Czoning_district",
)
DEFAULT_OBSERVED_SALES_PATH = os.environ.get("VANCOUVER_BCA_SALES_PATH", "")
PROXY_WEIGHT = 0.35
OBSERVED_WEIGHT = 1.0
UPLIFT_BOOTSTRAP_REPEATS = 250
MIN_TYPE_ROWS = 40
POSTAL_CODE_PATTERN = re.compile(r"^[A-Z]\d[A-Z]\d[A-Z]\d$")
ADDRESS_SPLIT_PATTERN = re.compile(r"^\s*(\d+)\s+(.+?)\s*$")

UPLIFT_NUMERIC_FEATURES = [
    "baseValue",
    "propertyTax",
    "latitude",
    "longitude",
    "lat_x_lon",
    "lat_sq",
    "lon_sq",
    "horizonMonths",
    "permitProjectValue",
    "permitElapsedDays",
    "issueYear",
]
UPLIFT_CATEGORICAL_FEATURES = ["postalFsa", "submarketCluster", "propertyType", "geoLocalArea", "zoningDistrict"]
FLAG_FEATURES = [
    "renovatedKitchen",
    "renovatedBathrooms",
    "legalSuiteAdded",
    "energyEfficient",
    "curbAppealImproved",
    "permitIssuesResolved",
    "deferredMaintenanceResolved",
    "roofIssueResolved",
]

IMPROVEMENT_CATALOG: dict[str, dict[str, Any]] = {
    "renovatedKitchen": {
        "label": "Renovated kitchen",
        "defaultCost": 65000,
        "months": 2,
        "phase": "Interior",
        "keywords": ["kitchen", "cabinet", "counter", "millwork", "appliance"],
    },
    "renovatedBathrooms": {
        "label": "Renovated bathrooms",
        "defaultCost": 35000,
        "months": 2,
        "phase": "Interior",
        "keywords": ["bathroom", "washroom", "ensuite", "fixture", "plumbing"],
    },
    "legalSuiteAdded": {
        "label": "Legal suite added",
        "defaultCost": 90000,
        "months": 4,
        "phase": "Income",
        "keywords": ["suite", "secondary suite", "lock off", "basement suite", "laneway", "accessory dwelling"],
    },
    "energyEfficient": {
        "label": "Energy upgrades",
        "defaultCost": 22000,
        "months": 2,
        "phase": "Efficiency",
        "keywords": ["energy", "window", "insulation", "heat pump", "hvac", "mechanical", "envelope"],
    },
    "curbAppealImproved": {
        "label": "Curb appeal",
        "defaultCost": 18000,
        "months": 1,
        "phase": "Exterior",
        "keywords": ["landscape", "facade", "exterior", "paint", "entry", "deck", "patio"],
    },
    "permitIssuesResolved": {
        "label": "Permit issues resolved",
        "defaultCost": 12000,
        "months": 1,
        "phase": "Compliance",
        "keywords": ["field review", "permit", "occupancy", "code", "compliance"],
    },
    "deferredMaintenanceResolved": {
        "label": "Deferred maintenance resolved",
        "defaultCost": 28000,
        "months": 2,
        "phase": "Readiness",
        "keywords": ["repair", "replace", "maintenance", "structural", "foundation", "drainage"],
    },
    "roofIssueResolved": {
        "label": "Roof and systems resolved",
        "defaultCost": 24000,
        "months": 1,
        "phase": "Readiness",
        "keywords": ["roof", "roofing", "boiler", "furnace", "electrical", "rewire"],
    },
}


@dataclass
class UpliftModelBundle:
    ready: bool
    model_version: str
    training_mode: str
    trained_at: str
    data_sources: dict[str, str]
    row_counts: dict[str, int]
    models: dict[str, Pipeline]
    model_families: dict[str, str]
    confidence_error_ratios: dict[str, float]
    evaluation_summary: dict[str, Any]
    evidence_level: str
    observed_share: float
    available_flags: list[str]
    xgboost_available: bool
    xgboost_import_error: str | None


_UPLIFT_BUNDLE: UpliftModelBundle | None = None


def _safe_ohe() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def _read_table(path_or_url: str, columns: list[str] | None = None) -> pd.DataFrame:
    if not path_or_url:
        raise FileNotFoundError("Missing data path")

    usecols = None
    if columns:
        wanted = {column.lower() for column in columns}
        usecols = lambda column: str(column).strip().lower() in wanted

    for separator in (";", ","):
        try:
            frame = pd.read_csv(path_or_url, sep=separator, low_memory=False, usecols=usecols)
            if frame.shape[1] > 1:
                return frame
        except Exception:
            continue

    raise ValueError(f"Unable to read dataset: {path_or_url}")


def _normalize_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _normalize_address(value: Any) -> str | None:
    text = _normalize_text(value).upper()
    if not text:
        return None

    text = text.split(",")[0]
    text = text.replace(".", "")
    text = re.sub(r"\s+", " ", text).strip()
    match = ADDRESS_SPLIT_PATTERN.match(text)
    if not match:
        return text
    civic, street = match.groups()
    street = street.replace(" STREET", " ST")
    street = street.replace(" AVENUE", " AVE")
    street = street.replace(" BOULEVARD", " BLVD")
    street = street.replace(" DRIVE", " DR")
    street = street.replace(" ROAD", " RD")
    return f"{int(civic)} {street}"


def _parse_geo_point(value: Any) -> tuple[float | None, float | None]:
    text = _normalize_text(value)
    if not text:
        return None, None

    coords = re.findall(r"-?\d+\.\d+", text)
    if len(coords) >= 2:
        first = float(coords[0])
        second = float(coords[1])
        if -125 < first < -122 and 48 < second < 50:
            return second, first
        if 48 < first < 50 and -125 < second < -122:
            return first, second

    return None, None


def _infer_property_type(text: str) -> str | None:
    lowered = text.lower()
    if "duplex" in lowered or "two family" in lowered or "two-family" in lowered:
        return "Duplex"
    if "townhouse" in lowered or "townhome" in lowered:
        return "Townhouse"
    if "condo" in lowered or "apartment" in lowered or "strata" in lowered:
        return "Condo"
    if "dwelling" in lowered or "house" in lowered or "single family" in lowered or "single-family" in lowered:
        return "Detached"
    return None


def _extract_flag_map(text: str) -> dict[str, int]:
    lowered = text.lower()
    flags = {flag: 0 for flag in FLAG_FEATURES}
    for flag, item in IMPROVEMENT_CATALOG.items():
        if any(keyword in lowered for keyword in item["keywords"]):
            flags[flag] = 1
    return flags


def _choose_property_type(text: str, fallback: str | None = None) -> str:
    inferred = _infer_property_type(text)
    if inferred in PROPERTY_TYPES:
        return inferred
    if fallback in PROPERTY_TYPES:
        return fallback
    return "Detached"


def _load_city_permits(path_or_url: str = DEFAULT_CITY_PERMITS_PATH) -> pd.DataFrame:
    permits = _read_table(
        path_or_url,
        columns=[
            "permitnumber",
            "issuedate",
            "issueyear",
            "permitelapseddays",
            "projectvalue",
            "typeofwork",
            "address",
            "projectdescription",
            "permitcategory",
            "propertyuse",
            "specificusecategory",
            "geolocalarea",
            "geo_point_2d",
        ],
    )
    permits.columns = [str(column).strip() for column in permits.columns]
    permits["projectvalue"] = permits["projectvalue"].map(_parse_numeric)
    permits["permitelapseddays"] = permits["permitelapseddays"].map(_parse_numeric).fillna(0)
    permits["issuedate"] = pd.to_datetime(permits["issuedate"], errors="coerce")
    permits["issueyear"] = permits["issueyear"].map(_parse_numeric).fillna(permits["issuedate"].dt.year)
    permits["normalizedAddress"] = permits["address"].map(_normalize_address)
    lat_lon = permits["geo_point_2d"].map(_parse_geo_point)
    permits["latitude"] = [item[0] for item in lat_lon]
    permits["longitude"] = [item[1] for item in lat_lon]

    combined_text = (
        permits["projectdescription"].map(_normalize_text)
        + " "
        + permits["permitcategory"].map(_normalize_text)
        + " "
        + permits["propertyuse"].map(_normalize_text)
        + " "
        + permits["specificusecategory"].map(_normalize_text)
        + " "
        + permits["typeofwork"].map(_normalize_text)
    )
    permits["propertyType"] = [
        _choose_property_type(text)
        for text in combined_text
    ]
    flag_rows = combined_text.map(_extract_flag_map)
    for flag in FLAG_FEATURES:
        permits[flag] = [row[flag] for row in flag_rows]

    residential_mask = (
        permits["typeofwork"].fillna("").astype(str).str.contains("Addition / Alteration", case=False, na=False)
        & permits["normalizedAddress"].notna()
        & permits["projectvalue"].fillna(0).gt(0)
        & (permits[FLAG_FEATURES].sum(axis=1) > 0)
        & permits["issueyear"].fillna(0).ge(2022)
    )

    return permits.loc[residential_mask].copy()


def _load_property_tax(path_or_url: str = DEFAULT_PROPERTY_TAX_PATH) -> pd.DataFrame:
    columns = [
        "report_year",
        "tax_assessment_year",
        "current_land_value",
        "current_improvement_value",
        "previous_land_value",
        "previous_improvement_value",
        "tax_levy",
        "year_built",
        "big_improvement_year",
        "property_postal_code",
        "from_civic_number",
        "street_name",
        "zoning_district",
    ]

    if path_or_url.startswith("http"):
        frames: list[pd.DataFrame] = []
        current_year = datetime.utcnow().year
        start_year = max(2022, current_year - 4)
        for year in range(start_year, current_year + 1):
            year_filter = quote(f"tax_assessment_year = '{year}'")
            filtered_url = f"{path_or_url}&where={year_filter}"
            year_frame = _read_table(filtered_url, columns=columns)
            if not year_frame.empty:
                frames.append(year_frame)
        tax = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=columns)
    else:
        tax = _read_table(path_or_url, columns=columns)

    tax.columns = [str(column).strip() for column in tax.columns]
    tax["report_year"] = tax["report_year"].map(_parse_numeric)
    tax["tax_assessment_year"] = tax["tax_assessment_year"].map(_parse_numeric)
    tax["current_land_value"] = tax["current_land_value"].map(_parse_numeric).fillna(0)
    tax["current_improvement_value"] = tax["current_improvement_value"].map(_parse_numeric).fillna(0)
    tax["previous_land_value"] = tax["previous_land_value"].map(_parse_numeric).fillna(0)
    tax["previous_improvement_value"] = tax["previous_improvement_value"].map(_parse_numeric).fillna(0)
    tax["tax_levy"] = tax["tax_levy"].map(_parse_numeric)
    tax["year_built"] = tax["year_built"].map(_parse_numeric)
    tax["big_improvement_year"] = tax["big_improvement_year"].map(_parse_numeric)
    tax["property_postal_code"] = tax["property_postal_code"].map(_normalize_postal_code)
    tax["normalizedAddress"] = (
        tax["from_civic_number"].map(_parse_numeric).fillna(0).astype(int).astype(str)
        + " "
        + tax["street_name"].map(_normalize_text).str.upper()
    ).map(_normalize_address)
    tax["baseAssessmentValue"] = tax["previous_land_value"] + tax["previous_improvement_value"]
    tax["currentAssessmentValue"] = tax["current_land_value"] + tax["current_improvement_value"]
    tax["proxyImprovementDelta"] = tax["current_improvement_value"] - tax["previous_improvement_value"]
    return tax.loc[tax["report_year"].fillna(0).ge(2017)].copy()


def _resolve_alias(frame: pd.DataFrame, aliases: list[str], required: bool = True) -> str | None:
    columns = {column.lower(): column for column in frame.columns}
    for alias in aliases:
        if alias.lower() in columns:
            return columns[alias.lower()]
    if required:
        raise ValueError(f"Missing required column alias. Expected one of: {', '.join(aliases)}")
    return None


def _load_observed_sales(path_or_url: str) -> pd.DataFrame:
    sales = _read_table(path_or_url)
    sales.columns = [str(column).strip() for column in sales.columns]

    mappings = {
        "propertyId": _resolve_alias(sales, ["propertyId", "property_id", "pid", "folio", "folio_id"], required=False),
        "address": _resolve_alias(sales, ["address", "streetAddress", "street_address", "property_address"]),
        "postalCode": _resolve_alias(sales, ["postalCode", "postal_code", "property_postal_code"], required=False),
        "saleDate": _resolve_alias(sales, ["saleDate", "sale_date", "transaction_date", "sale_created_date"]),
        "salePrice": _resolve_alias(sales, ["salePrice", "sale_price", "price", "transaction_price"]),
        "propertyType": _resolve_alias(sales, ["propertyType", "property_type", "type"], required=False),
        "propertyTax": _resolve_alias(sales, ["propertyTax", "property_tax", "tax_levy"], required=False),
        "latitude": _resolve_alias(sales, ["latitude", "lat"], required=False),
        "longitude": _resolve_alias(sales, ["longitude", "lon", "lng"], required=False),
    }

    normalized = pd.DataFrame(
        {
            "propertyId": sales[mappings["propertyId"]] if mappings["propertyId"] else pd.Series([None] * len(sales)),
            "address": sales[mappings["address"]],
            "postalCode": sales[mappings["postalCode"]] if mappings["postalCode"] else pd.Series([None] * len(sales)),
            "saleDate": sales[mappings["saleDate"]],
            "salePrice": sales[mappings["salePrice"]],
            "propertyType": sales[mappings["propertyType"]] if mappings["propertyType"] else pd.Series([None] * len(sales)),
            "propertyTax": sales[mappings["propertyTax"]] if mappings["propertyTax"] else pd.Series([None] * len(sales)),
            "latitude": sales[mappings["latitude"]] if mappings["latitude"] else pd.Series([None] * len(sales)),
            "longitude": sales[mappings["longitude"]] if mappings["longitude"] else pd.Series([None] * len(sales)),
        }
    )
    normalized["propertyId"] = normalized["propertyId"].map(_normalize_text).replace("", np.nan)
    normalized["normalizedAddress"] = normalized["address"].map(_normalize_address)
    normalized["postalCode"] = normalized["postalCode"].map(_normalize_postal_code)
    normalized["saleDate"] = pd.to_datetime(normalized["saleDate"], errors="coerce")
    normalized["salePrice"] = normalized["salePrice"].map(_parse_numeric)
    normalized["propertyTax"] = normalized["propertyTax"].map(_parse_numeric)
    normalized["latitude"] = normalized["latitude"].map(_parse_numeric)
    normalized["longitude"] = normalized["longitude"].map(_parse_numeric)
    normalized["propertyType"] = normalized["propertyType"].map(_normalize_text)
    normalized["propertyType"] = [
        _choose_property_type(value, fallback=_choose_property_type(value))
        for value in normalized["propertyType"]
    ]
    return normalized.loc[
        normalized["normalizedAddress"].notna()
        & normalized["saleDate"].notna()
        & normalized["salePrice"].notna()
    ].copy()


def _estimate_market_factor(sales: pd.DataFrame, property_type: str, earlier: pd.Timestamp, later: pd.Timestamp) -> float:
    sales = sales.copy()
    sales["saleYearMonth"] = sales["saleDate"].dt.to_period("M").astype(str)
    subset = sales.loc[sales["propertyType"].eq(property_type)].copy()
    if subset.empty:
        return 1.0

    by_month = subset.groupby("saleYearMonth")["salePrice"].median()
    earlier_key = earlier.to_period("M").strftime("%Y-%m")
    later_key = later.to_period("M").strftime("%Y-%m")
    earlier_value = float(by_month.get(earlier_key, by_month.median()))
    later_value = float(by_month.get(later_key, by_month.median()))
    if earlier_value <= 0:
        return 1.0
    return float(np.clip(later_value / earlier_value, 0.7, 1.5))


def _build_proxy_rows(permits: pd.DataFrame, tax: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    tax_groups = {key: frame.sort_values("report_year") for key, frame in tax.groupby("normalizedAddress")}

    for _, permit in permits.iterrows():
        address_key = permit["normalizedAddress"]
        if address_key not in tax_groups:
            continue

        candidates = tax_groups[address_key]
        issue_year = int(permit["issueyear"]) if pd.notna(permit["issueyear"]) else None
        if issue_year is None:
            continue

        match = candidates.loc[candidates["report_year"].between(issue_year, issue_year + 2)]
        if match.empty:
            continue
        match = match.sort_values(["report_year", "proxyImprovementDelta"], ascending=[True, False]).iloc[0]
        postal_code = match.get("property_postal_code") or None
        if postal_code is None or not isinstance(postal_code, str):
            continue

        latitude = permit["latitude"]
        longitude = permit["longitude"]
        if pd.isna(latitude) or pd.isna(longitude):
            base_bundle = load_bundle()
            latitude, longitude = _resolve_centroid(base_bundle, postal_code)

        horizon_months = max(3.0, min(18.0, ((float(match["report_year"]) - float(issue_year)) * 12) + 6))
        project_value = float(permit["projectvalue"] or 0.0)
        uplift_value = float(match["proxyImprovementDelta"])
        if not np.isfinite(uplift_value):
            continue

        location_payload = _location_feature_payload(load_bundle(), float(latitude), float(longitude))
        feature_row = {
            "propertyType": permit["propertyType"],
            "baseValue": float(match["baseAssessmentValue"]),
            "propertyTax": float(match["tax_levy"] or 0.0),
            "postalFsa": postal_code[:3],
            "geoLocalArea": _normalize_text(permit.get("geolocalarea")) or "Vancouver",
            "zoningDistrict": _normalize_text(match.get("zoning_district")) or "Unknown",
            "horizonMonths": float(horizon_months),
            "permitProjectValue": project_value,
            "permitElapsedDays": float(permit["permitelapseddays"] or 0.0),
            "issueYear": float(issue_year),
            "upliftValue": uplift_value,
            "sampleWeight": PROXY_WEIGHT,
            "evidenceSource": "proxy",
            **location_payload,
        }
        for flag in FLAG_FEATURES:
            feature_row[flag] = int(permit[flag])
        rows.append(feature_row)

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    return frame.loc[
        frame["propertyType"].isin(PROPERTY_TYPES)
        & frame["baseValue"].gt(50_000)
        & frame["postalFsa"].fillna("").str.startswith(("V5", "V6"))
    ].copy()


def _build_observed_rows(permits: pd.DataFrame, sales: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    sales = sales.sort_values("saleDate").copy()
    sales_groups = {key: frame for key, frame in sales.groupby("normalizedAddress")}

    for address_key, permit_group in permits.groupby("normalizedAddress"):
        if address_key not in sales_groups:
            continue
        sales_group = sales_groups[address_key]
        for _, permit in permit_group.iterrows():
            permit_date = permit["issuedate"]
            if pd.isna(permit_date):
                continue

            prior_sales = sales_group.loc[sales_group["saleDate"] < permit_date]
            future_sales = sales_group.loc[
                sales_group["saleDate"].between(
                    permit_date + pd.Timedelta(days=90),
                    permit_date + pd.Timedelta(days=365),
                )
            ]
            if prior_sales.empty or future_sales.empty:
                continue

            prev_sale = prior_sales.iloc[-1]
            next_sale = future_sales.iloc[0]
            property_type = _choose_property_type(
                _normalize_text(next_sale.get("propertyType")) or _normalize_text(prev_sale.get("propertyType")),
                fallback="Detached",
            )
            if property_type not in PROPERTY_TYPES:
                continue

            postal_code = next_sale.get("postalCode") or prev_sale.get("postalCode")
            if not postal_code or not isinstance(postal_code, str):
                continue

            market_factor = _estimate_market_factor(sales, property_type, prev_sale["saleDate"], next_sale["saleDate"])
            base_value = float(prev_sale["salePrice"]) * market_factor
            uplift_value = float(next_sale["salePrice"]) - base_value

            latitude = _parse_numeric(next_sale.get("latitude"))
            longitude = _parse_numeric(next_sale.get("longitude"))
            if latitude is None or longitude is None:
                base_bundle = load_bundle()
                latitude, longitude = _resolve_centroid(base_bundle, postal_code)

            location_payload = _location_feature_payload(load_bundle(), float(latitude), float(longitude))
            row = {
                "propertyType": property_type,
                "baseValue": base_value,
                "propertyTax": float(_parse_numeric(next_sale.get("propertyTax")) or _parse_numeric(prev_sale.get("propertyTax")) or 0.0),
                "postalFsa": postal_code[:3],
                "geoLocalArea": "Vancouver",
                "zoningDistrict": "Unknown",
                "horizonMonths": max(3.0, min(18.0, (next_sale["saleDate"] - permit_date).days / 30.4)),
                "permitProjectValue": float(permit["projectvalue"] or 0.0),
                "permitElapsedDays": float(permit["permitelapseddays"] or 0.0),
                "issueYear": float(permit["issueyear"] or permit_date.year),
                "upliftValue": uplift_value,
                "sampleWeight": OBSERVED_WEIGHT,
                "evidenceSource": "observed",
                **location_payload,
            }
            for flag in FLAG_FEATURES:
                row[flag] = int(permit[flag])
            rows.append(row)

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    return frame.loc[frame["propertyType"].isin(PROPERTY_TYPES)].copy()


def _build_uplift_preprocessor() -> ColumnTransformer:
    numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    categorical_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", _safe_ohe()),
        ]
    )

    return ColumnTransformer(
        transformers=[
            ("num", numeric_pipeline, UPLIFT_NUMERIC_FEATURES + FLAG_FEATURES),
            ("cat", categorical_pipeline, UPLIFT_CATEGORICAL_FEATURES),
        ],
        remainder="drop",
    )


def _build_uplift_candidates() -> dict[str, Pipeline]:
    candidates: dict[str, Pipeline] = {
        "random-forest": Pipeline(
            [
                ("prep", _build_uplift_preprocessor()),
                (
                    "model",
                    RandomForestRegressor(
                        n_estimators=400,
                        min_samples_leaf=2,
                        random_state=42,
                        n_jobs=4,
                    ),
                ),
            ]
        )
    }
    if XGBOOST_AVAILABLE:
        candidates["xgboost"] = Pipeline(
            [
                ("prep", _build_uplift_preprocessor()),
                (
                    "model",
                    XGBRegressor(
                        objective="reg:squarederror",
                        n_estimators=350,
                        max_depth=5,
                        learning_rate=0.05,
                        subsample=0.9,
                        colsample_bytree=0.9,
                        reg_lambda=1.2,
                        random_state=42,
                        n_jobs=4,
                    ),
                ),
            ]
        )
    return candidates


def _evaluate_uplift_predictions(actual: np.ndarray, predicted: np.ndarray) -> dict[str, Any]:
    denominator = np.maximum(np.abs(actual), 50_000.0)
    abs_pct = np.abs(predicted - actual) / denominator
    sign_accuracy = float(np.mean(np.sign(predicted) == np.sign(actual)))
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "mape": float(np.mean(abs_pct)),
        "r2": float(r2_score(actual, predicted)) if len(actual) > 1 else 0.0,
        "signAccuracy": sign_accuracy,
        "errorRatios": abs_pct.tolist(),
    }


def _build_uplift_strata(target: pd.Series) -> pd.Series:
    signed = np.where(target >= 0, "pos", "neg")
    abs_target = np.abs(target)
    try:
        bins = pd.qcut(abs_target, q=min(4, max(2, abs_target.nunique())), duplicates="drop")
        return pd.Series([f"{sign}-{bucket}" for sign, bucket in zip(signed, bins.astype(str))], index=target.index)
    except ValueError:
        return pd.Series(signed, index=target.index)


def _select_cv_splitter(strata: pd.Series) -> StratifiedKFold | KFold:
    min_count = int(strata.value_counts().min()) if not strata.empty else 0
    total_rows = len(strata)
    if total_rows >= 5 and min_count >= 5:
        return StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    if total_rows >= 3 and min_count >= 3:
        return StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
    if total_rows >= 5:
        return KFold(n_splits=5, shuffle=True, random_state=42)
    return KFold(n_splits=3, shuffle=True, random_state=42)


def _bootstrap_metric_summary(actual: np.ndarray, predicted: np.ndarray, repeats: int = UPLIFT_BOOTSTRAP_REPEATS) -> dict[str, Any]:
    rng = np.random.default_rng(42)
    sample_size = len(actual)
    mae_samples: list[float] = []
    rmse_samples: list[float] = []
    mape_samples: list[float] = []
    r2_samples: list[float] = []
    sign_samples: list[float] = []

    for _ in range(repeats):
        sample_index = rng.integers(0, sample_size, size=sample_size)
        metrics = _evaluate_uplift_predictions(actual[sample_index], predicted[sample_index])
        mae_samples.append(metrics["mae"])
        rmse_samples.append(metrics["rmse"])
        mape_samples.append(metrics["mape"])
        r2_samples.append(metrics["r2"])
        sign_samples.append(metrics["signAccuracy"])

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
        "signAccuracy": _summary(sign_samples),
        "repeats": repeats,
    }


def _train_candidate_model(frame: pd.DataFrame) -> tuple[Pipeline, str, dict[str, Any], float]:
    features = frame[UPLIFT_NUMERIC_FEATURES + FLAG_FEATURES + UPLIFT_CATEGORICAL_FEATURES].copy()
    target = frame["upliftValue"].to_numpy(dtype=float)
    weights = frame["sampleWeight"].to_numpy(dtype=float)
    strata = _build_uplift_strata(frame["upliftValue"])
    stratify = strata if strata.nunique() > 1 else None

    train_index, test_index = train_test_split(
        frame.index.to_numpy(),
        test_size=0.2,
        random_state=42,
        stratify=stratify,
    )
    x_train = features.loc[train_index]
    x_test = features.loc[test_index]
    y_train = frame.loc[train_index, "upliftValue"].to_numpy(dtype=float)
    y_test = frame.loc[test_index, "upliftValue"].to_numpy(dtype=float)
    w_train = frame.loc[train_index, "sampleWeight"].to_numpy(dtype=float)
    train_strata = strata.loc[train_index]
    cv_splitter = _select_cv_splitter(train_strata)

    candidate_metrics: dict[str, Any] = {}
    candidates = _build_uplift_candidates()
    for candidate_name, pipeline in candidates.items():
        cv_mae: list[float] = []
        cv_rmse: list[float] = []
        cv_mape: list[float] = []
        cv_r2: list[float] = []
        cv_sign: list[float] = []

        if isinstance(cv_splitter, StratifiedKFold):
            split_iter = cv_splitter.split(x_train, train_strata)
        else:
            split_iter = cv_splitter.split(x_train)

        for cv_train_pos, cv_valid_pos in split_iter:
            cv_train_index = x_train.index[cv_train_pos]
            cv_valid_index = x_train.index[cv_valid_pos]
            candidate = clone(pipeline)
            candidate.fit(
                x_train.loc[cv_train_index],
                frame.loc[cv_train_index, "upliftValue"].to_numpy(dtype=float),
                model__sample_weight=frame.loc[cv_train_index, "sampleWeight"].to_numpy(dtype=float),
            )
            cv_predicted = candidate.predict(x_train.loc[cv_valid_index])
            cv_actual = frame.loc[cv_valid_index, "upliftValue"].to_numpy(dtype=float)
            cv_metrics = _evaluate_uplift_predictions(cv_actual, cv_predicted)
            cv_mae.append(cv_metrics["mae"])
            cv_rmse.append(cv_metrics["rmse"])
            cv_mape.append(cv_metrics["mape"])
            cv_r2.append(cv_metrics["r2"])
            cv_sign.append(cv_metrics["signAccuracy"])

        fitted = clone(pipeline)
        fitted.fit(x_train, y_train, model__sample_weight=w_train)
        holdout_predicted = fitted.predict(x_test)
        holdout_metrics = _evaluate_uplift_predictions(y_test, holdout_predicted)
        candidate_metrics[candidate_name] = {
            "available": True,
            "cv": {
                "folds": len(cv_mae),
                "maeMean": float(np.mean(cv_mae)),
                "rmseMean": float(np.mean(cv_rmse)),
                "mapeMean": float(np.mean(cv_mape)),
                "r2Mean": float(np.mean(cv_r2)),
                "signAccuracyMean": float(np.mean(cv_sign)),
            },
            "holdout": {
                "rows": int(len(test_index)),
                "mae": holdout_metrics["mae"],
                "rmse": holdout_metrics["rmse"],
                "mape": holdout_metrics["mape"],
                "r2": holdout_metrics["r2"],
                "signAccuracy": holdout_metrics["signAccuracy"],
            },
            "_holdoutPredictions": holdout_predicted.tolist(),
            "_errorRatios": holdout_metrics["errorRatios"],
        }

    if not XGBOOST_AVAILABLE:
        candidate_metrics["xgboost"] = {"available": False, "reason": XGBOOST_IMPORT_ERROR}

    selected_family = min(
        (name for name, item in candidate_metrics.items() if item.get("available")),
        key=lambda name: float(candidate_metrics[name]["cv"]["maeMean"]),
    )
    selected_pipeline = clone(candidates[selected_family])
    selected_pipeline.fit(features, target, model__sample_weight=weights)
    confidence_ratio = float(
        np.clip(
            np.quantile(candidate_metrics[selected_family].pop("_errorRatios"), 0.7),
            0.12,
            0.45,
        )
    )
    holdout_predictions = np.array(candidate_metrics[selected_family].pop("_holdoutPredictions"), dtype=float)
    bootstrap = _bootstrap_metric_summary(y_test, holdout_predictions)
    evaluation = {
        "selectedModel": selected_family,
        "trainingRows": int(len(frame)),
        "cv": candidate_metrics[selected_family]["cv"],
        "holdout": candidate_metrics[selected_family]["holdout"],
        "bootstrap": bootstrap,
    }
    return selected_pipeline, selected_family, evaluation, confidence_ratio


def _train_uplift_bundle() -> UpliftModelBundle:
    permits = _load_city_permits(DEFAULT_CITY_PERMITS_PATH)
    tax = _load_property_tax(DEFAULT_PROPERTY_TAX_PATH)
    proxy_rows = _build_proxy_rows(permits, tax)

    observed_rows = pd.DataFrame()
    if DEFAULT_OBSERVED_SALES_PATH:
        try:
            sales = _load_observed_sales(DEFAULT_OBSERVED_SALES_PATH)
            observed_rows = _build_observed_rows(permits, sales)
        except Exception:
            observed_rows = pd.DataFrame()

    frames = [frame for frame in [observed_rows, proxy_rows] if not frame.empty]
    if not frames:
        return UpliftModelBundle(
            ready=False,
            model_version=UPLIFT_MODEL_VERSION,
            training_mode=UPLIFT_TRAINING_MODE,
            trained_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
            data_sources={
                "cityPermits": DEFAULT_CITY_PERMITS_PATH,
                "propertyTax": DEFAULT_PROPERTY_TAX_PATH,
                "observedSales": DEFAULT_OBSERVED_SALES_PATH,
            },
            row_counts={"proxyRows": 0, "observedRows": 0, "trainingRows": 0},
            models={},
            model_families={},
            confidence_error_ratios={},
            evaluation_summary={"message": "No uplift rows could be assembled from the configured sources."},
            evidence_level="proxy-heavy",
            observed_share=0.0,
            available_flags=list(IMPROVEMENT_CATALOG.keys()),
            xgboost_available=XGBOOST_AVAILABLE,
            xgboost_import_error=XGBOOST_IMPORT_ERROR,
        )

    training_frame = pd.concat(frames, ignore_index=True)
    training_frame = training_frame.loc[
        training_frame["propertyType"].isin(PROPERTY_TYPES)
        & training_frame["baseValue"].gt(50_000)
        & training_frame["postalFsa"].fillna("").str.startswith(("V5", "V6"))
    ].copy()

    models: dict[str, Pipeline] = {}
    model_families: dict[str, str] = {}
    confidence_error_ratios: dict[str, float] = {}
    evaluations: dict[str, Any] = {}

    pooled_model, pooled_family, pooled_evaluation, pooled_confidence = _train_candidate_model(training_frame)
    models["pooled"] = pooled_model
    model_families["pooled"] = pooled_family
    confidence_error_ratios["pooled"] = pooled_confidence
    evaluations["pooled"] = pooled_evaluation

    for property_type, frame in training_frame.groupby("propertyType"):
        if len(frame) < MIN_TYPE_ROWS:
            continue
        model, family, evaluation, confidence_ratio = _train_candidate_model(frame)
        models[property_type] = model
        model_families[property_type] = family
        confidence_error_ratios[property_type] = confidence_ratio
        evaluations[property_type] = evaluation

    observed_share = float(len(observed_rows) / len(training_frame)) if len(training_frame) else 0.0
    if observed_share >= 0.7:
        evidence_level = "observed"
    elif observed_share >= 0.25:
        evidence_level = "hybrid"
    else:
        evidence_level = "proxy-heavy"

    bundle = UpliftModelBundle(
        ready=True,
        model_version=UPLIFT_MODEL_VERSION,
        training_mode=UPLIFT_TRAINING_MODE,
        trained_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
        data_sources={
            "cityPermits": DEFAULT_CITY_PERMITS_PATH,
            "propertyTax": DEFAULT_PROPERTY_TAX_PATH,
            "observedSales": DEFAULT_OBSERVED_SALES_PATH or "",
        },
        row_counts={
            "permitRows": int(len(permits)),
            "proxyRows": int(len(proxy_rows)),
            "observedRows": int(len(observed_rows)),
            "trainingRows": int(len(training_frame)),
        },
        models=models,
        model_families=model_families,
        confidence_error_ratios=confidence_error_ratios,
        evaluation_summary={
            "perModel": evaluations,
            "window": "90 to 365 days after permit issuance for observed rows",
            "proxyLabel": "current_improvement_value - previous_improvement_value",
            "flagCoverage": {
                flag: int(training_frame[flag].sum()) for flag in FLAG_FEATURES
            },
        },
        evidence_level=evidence_level,
        observed_share=observed_share,
        available_flags=list(IMPROVEMENT_CATALOG.keys()),
        xgboost_available=XGBOOST_AVAILABLE,
        xgboost_import_error=XGBOOST_IMPORT_ERROR,
    )
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with UPLIFT_ARTIFACT_PATH.open("wb") as artifact_file:
        pickle.dump(bundle, artifact_file)
    return bundle


def load_uplift_bundle(force_retrain: bool = False) -> UpliftModelBundle:
    global _UPLIFT_BUNDLE
    if _UPLIFT_BUNDLE is not None and not force_retrain:
        return _UPLIFT_BUNDLE

    if not force_retrain and UPLIFT_ARTIFACT_PATH.exists():
        try:
            with UPLIFT_ARTIFACT_PATH.open("rb") as artifact_file:
                bundle = pickle.load(artifact_file)
            if isinstance(bundle, UpliftModelBundle):
                _UPLIFT_BUNDLE = bundle
                return bundle
        except Exception:
            pass

    _UPLIFT_BUNDLE = _train_uplift_bundle()
    return _UPLIFT_BUNDLE


def _normalize_simulation_request(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str], float]:
    base_bundle = load_bundle()
    property_payload = {
        key: payload.get(key)
        for key in ["postalCode", "propertyType", "livingAreaSqft", "bedrooms", "bathrooms", "propertyTax", "knownCurrentValue"]
    }
    estimate = estimate_property(property_payload)
    postal_code = _normalize_postal_code(payload.get("postalCode"))
    if postal_code is None:
        raise ValueError("postalCode must be a Vancouver postal code like V6B 1X9")

    planned_flags = []
    for flag in payload.get("plannedFlags", []) or []:
        if flag in IMPROVEMENT_CATALOG and flag not in planned_flags:
            planned_flags.append(flag)

    horizon_months = _parse_numeric(payload.get("horizonMonths")) or 9.0
    horizon_months = float(np.clip(horizon_months, 3.0, 18.0))
    latitude, longitude = _resolve_centroid(base_bundle, postal_code)
    normalized = {
        "postalCode": postal_code,
        "postalFsa": postal_code[:3],
        "propertyType": str(payload.get("propertyType") or "").strip(),
        "propertyTax": float(_parse_numeric(payload.get("propertyTax")) or 0.0),
        "baseValue": float(estimate["baseValue"]),
        "marketContext": estimate["marketContext"],
        **_location_feature_payload(base_bundle, latitude, longitude),
    }
    return normalized, planned_flags, horizon_months


def _build_feature_row(normalized: dict[str, Any], planned_flags: list[str], horizon_months: float) -> pd.DataFrame:
    row = {
        "baseValue": normalized["baseValue"],
        "propertyTax": normalized["propertyTax"],
        "latitude": normalized["latitude"],
        "longitude": normalized["longitude"],
        "lat_x_lon": normalized["lat_x_lon"],
        "lat_sq": normalized["lat_sq"],
        "lon_sq": normalized["lon_sq"],
        "horizonMonths": horizon_months,
        "permitProjectValue": float(sum(IMPROVEMENT_CATALOG[flag]["defaultCost"] for flag in planned_flags)),
        "permitElapsedDays": 0.0,
        "issueYear": float(datetime.utcnow().year),
        "postalFsa": normalized["postalFsa"],
        "submarketCluster": normalized["submarketCluster"],
        "propertyType": normalized["propertyType"],
        "geoLocalArea": "Vancouver",
        "zoningDistrict": "Unknown",
    }
    for flag in FLAG_FEATURES:
        row[flag] = 1 if flag in planned_flags else 0
    return pd.DataFrame([row])


def _model_key(bundle: UpliftModelBundle, property_type: str) -> str:
    if property_type in bundle.models:
        return property_type
    return "pooled"


def simulate_uplift(payload: dict[str, Any]) -> dict[str, Any]:
    base_estimate = estimate_property(payload)
    bundle = load_uplift_bundle(force_retrain=os.environ.get("UPLIFT_FORCE_RETRAIN") == "1")
    normalized, planned_flags, horizon_months = _normalize_simulation_request(payload)

    if not bundle.ready:
        return {
            "status": "data-missing",
            "message": "The uplift model could not assemble enough training rows from the configured Vancouver datasets.",
            "dataSources": bundle.data_sources,
            "rowCounts": bundle.row_counts,
        }

    if not planned_flags:
        return {
            "status": "ready",
            "modelVersion": bundle.model_version,
            "trainingMode": bundle.training_mode,
            "evidenceLevel": bundle.evidence_level,
            "baseValue": base_estimate["baseValue"],
            "upliftValue": 0,
            "finalValueRaw": base_estimate["baseValue"],
            "finalValueGuardrailed": base_estimate["baseValue"],
            "upliftConfidenceLow": 0,
            "upliftConfidenceHigh": 0,
            "ceilingFlag": False,
            "plannedFlags": [],
            "topUpliftDrivers": [],
            "modelFamily": bundle.model_families[_model_key(bundle, normalized["propertyType"])],
            "dataSources": bundle.data_sources,
        }

    model_key = _model_key(bundle, normalized["propertyType"])
    feature_frame = _build_feature_row(normalized, planned_flags, horizon_months)
    uplift_value = float(bundle.models[model_key].predict(feature_frame)[0])
    confidence_ratio = bundle.confidence_error_ratios[model_key]
    confidence_span = abs(uplift_value) * confidence_ratio
    uplift_low = round(uplift_value - confidence_span)
    uplift_high = round(uplift_value + confidence_span)

    driver_rows: list[dict[str, Any]] = []
    for flag in planned_flags:
        single_flag_frame = _build_feature_row(normalized, [flag], horizon_months)
        single_value = float(bundle.models[model_key].predict(single_flag_frame)[0])
        driver_rows.append(
            {
                "flag": flag,
                "label": IMPROVEMENT_CATALOG[flag]["label"],
                "value": round(single_value),
            }
        )

    top_drivers = sorted(driver_rows, key=lambda item: abs(item["value"]), reverse=True)[:5]
    final_value_raw = round(base_estimate["baseValue"] + uplift_value)
    practical_ceiling = int(base_estimate["marketContext"]["practicalCeiling"])
    final_value_guardrailed = min(final_value_raw, practical_ceiling)
    ceiling_flag = final_value_raw > practical_ceiling

    return {
        "status": "ready",
        "modelVersion": bundle.model_version,
        "trainingMode": bundle.training_mode,
        "modelFamily": bundle.model_families[model_key],
        "evidenceLevel": bundle.evidence_level,
        "baseValue": int(base_estimate["baseValue"]),
        "upliftValue": round(uplift_value),
        "finalValueRaw": int(final_value_raw),
        "finalValueGuardrailed": int(final_value_guardrailed),
        "upliftConfidenceLow": int(uplift_low),
        "upliftConfidenceHigh": int(uplift_high),
        "ceilingFlag": ceiling_flag,
        "plannedFlags": planned_flags,
        "topUpliftDrivers": top_drivers,
        "observedShare": round(bundle.observed_share, 4),
        "dataSources": bundle.data_sources,
    }


def uplift_health_payload() -> dict[str, Any]:
    bundle = load_uplift_bundle()
    return {
        "ready": bundle.ready,
        "modelVersion": bundle.model_version,
        "trainingMode": bundle.training_mode,
        "trainedAt": bundle.trained_at,
        "rowCounts": bundle.row_counts,
        "modelFamilies": bundle.model_families,
        "evaluationSummary": bundle.evaluation_summary,
        "evidenceLevel": bundle.evidence_level,
        "observedShare": bundle.observed_share,
        "dataSources": bundle.data_sources,
        "availableFlags": bundle.available_flags,
        "xgboostAvailable": bundle.xgboost_available,
        "xgboostImportError": bundle.xgboost_import_error,
    }
