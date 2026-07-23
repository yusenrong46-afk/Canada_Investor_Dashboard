from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import halifax_model
from halifax_model.core import HALIFAX_PREFIX_PATTERN, MARKET_LABEL, PROPERTY_TYPES, _normalize_postal_code

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_EXPORT_PATH = REPO_ROOT / "data" / "exports" / "halifax_uplift.json"

UPLIFT_MODEL_VERSION = "halifax-observed-permit-uplift-v1"
UPLIFT_TRAINING_MODE = "halifax-repeat-sale-permit-medians"
EVIDENCE_SUMMARY = (
    "Observed median excess uplift from HRM permit-linked PVSC repeat-sale pairs, "
    "applied to the Halifax base estimate."
)
DEDUPE_NOTE = "Each permit category is counted once, even when several selected improvements map to the same category."
SCOPE_NOTE = (
    "Kitchen, bathroom, energy, maintenance, and roof selections all map to the same broad Renovation permit category; "
    "they describe scope and cost but are not separate measured uplift effects."
)
CO_OCCURRENCE_NOTE = (
    "Renovation and Addition co-occurrence is unvalidated; when both categories are ready the API serves "
    "the single dominant category instead of summing them."
)

_EXPORT_CACHE: dict[str, dict[str, Any]] = {}


def _export_path() -> Path:
    override = os.environ.get("HALIFAX_UPLIFT_EXPORT_PATH")
    return Path(override).expanduser() if override else DEFAULT_EXPORT_PATH


def load_uplift_export() -> dict[str, Any]:
    path = _export_path().resolve()
    cache_key = str(path)
    if cache_key in _EXPORT_CACHE:
        return _EXPORT_CACHE[cache_key]

    if not path.is_file():
        raise ValueError(
            f"The committed Halifax uplift export is missing at {path}. "
            "Run scripts/build_halifax_uplift.py to rebuild it from PVSC repeat sales and HRM permits."
        )
    export = json.loads(path.read_text(encoding="utf-8"))
    _EXPORT_CACHE[cache_key] = export
    return export


def _validate_request(payload: dict[str, Any]) -> None:
    # Mirrors halifax_model._normalize_request so /uplift rejects with the same messages.
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


def _selected_categories(planned_flags: list[str], flag_category_map: dict[str, str]) -> list[str]:
    categories: list[str] = []
    for flag in planned_flags:
        category = flag_category_map[flag]
        if category not in categories:
            categories.append(category)
    return categories


def _treated_quantile_range(base_value: float, low_percent: float, high_percent: float) -> dict[str, Any]:
    return {
        "lowPercent": round(low_percent, 4),
        "highPercent": round(high_percent, 4),
        "lowValue": int(round(base_value * low_percent)),
        "highValue": int(round(base_value * high_percent)),
    }


def _zero_uplift_response(base_estimate: dict[str, Any], export: dict[str, Any]) -> dict[str, Any]:
    base_value = int(base_estimate["baseValue"])
    return {
        "status": "ready",
        "modelVersion": UPLIFT_MODEL_VERSION,
        "trainingMode": UPLIFT_TRAINING_MODE,
        "evidenceLevel": "observed",
        "evidenceSummary": "No selected improvements, so uplift is zero. " + EVIDENCE_SUMMARY,
        "baseValue": base_value,
        "upliftPercent": 0.0,
        "treatedQuantileRange": _treated_quantile_range(base_value, 0.0, 0.0),
        "upliftValue": 0,
        "finalValueRaw": base_value,
        "finalValueGuardrailed": base_value,
        "ceilingFlag": False,
        "plannedFlags": [],
        "topUpliftDrivers": [],
        "observedShare": 1.0,
        "methodNotes": [export["method"], DEDUPE_NOTE, SCOPE_NOTE],
    }


def simulate_uplift(payload: dict[str, Any]) -> dict[str, Any]:
    _validate_request(payload)
    export = load_uplift_export()
    flag_category_map: dict[str, str] = export["flagCategoryMap"]
    categories: dict[str, dict[str, Any]] = export["categories"]
    min_treated_pairs = int(export["minTreatedPairs"])

    planned_flags: list[str] = []
    for flag in payload.get("plannedFlags", []) or []:
        if flag in flag_category_map and flag not in planned_flags:
            planned_flags.append(flag)

    if not planned_flags:
        return _zero_uplift_response(halifax_model.estimate_property(payload), export)

    selected = _selected_categories(planned_flags, flag_category_map)
    ready = [category for category in selected if categories[category]["status"] == "ready"]
    insufficient = [category for category in selected if categories[category]["status"] != "ready"]

    if not ready:
        measured = "; ".join(
            f"{category}: {int(categories[category]['treatedPairs'])} treated permit pairs measured, "
            f"{min_treated_pairs} required"
            for category in insufficient
        )
        raise ValueError(
            f"Renovation uplift is not yet reportable for the selected improvements in {MARKET_LABEL}: "
            f"{measured}. The observed HRM permit / PVSC repeat-sale sample is too thin to quote honestly."
        )

    base_estimate = halifax_model.estimate_property(payload)
    base_value = float(base_estimate["baseValue"])

    method_notes = [export["method"], DEDUPE_NOTE, SCOPE_NOTE]
    if len(ready) > 1:
        dominant = max(ready, key=lambda category: float(categories[category]["medianExcessUpliftPercent"]))
        skipped_ready = [category for category in ready if category != dominant]
        ready = [dominant]
        method_notes.append(CO_OCCURRENCE_NOTE)
        method_notes.append(
            "Serving "
            + "; ".join(
                f"{category} ({float(categories[category]['medianExcessUpliftPercent']):.1%} median excess uplift)"
                for category in skipped_ready
            )
            + f" as zero because {dominant} is the dominant ready category."
        )

    uplift_percent = float(categories[ready[0]]["medianExcessUpliftPercent"])
    low_percent = float(categories[ready[0]]["p25ExcessUpliftPercent"])
    high_percent = float(categories[ready[0]]["p75ExcessUpliftPercent"])
    uplift_value = round(base_value * uplift_percent)
    final_value_raw = round(base_value + uplift_value)
    practical_ceiling = int(base_estimate["marketContext"]["practicalCeiling"])
    final_value_guardrailed = min(final_value_raw, practical_ceiling)

    driver_rows: list[dict[str, Any]] = []
    for category in ready:
        category_percent = float(categories[category]["medianExcessUpliftPercent"])
        first_flag = next(flag for flag in planned_flags if flag_category_map[flag] == category)
        driver_rows.append(
            {
                "flag": first_flag,
                "label": f"{category} permit ({MARKET_LABEL} observed)",
                "value": round(base_value * category_percent),
                "upliftPercent": round(category_percent, 4),
            }
        )

    treated_total = int(sum(categories[category]["treatedPairs"] for category in ready))
    control_pairs = int(max(categories[category]["controlPairs"] for category in ready))
    row_counts: dict[str, int] = {f"treatedPairs{category}": int(categories[category]["treatedPairs"]) for category in selected}
    row_counts["controlPairs"] = control_pairs
    row_counts["minTreatedPairs"] = min_treated_pairs

    if insufficient:
        skipped = "; ".join(
            f"{category} ({int(categories[category]['treatedPairs'])} treated pairs measured, {min_treated_pairs} required)"
            for category in insufficient
        )
        method_notes.append(
            f"Selected categories without enough observed pairs contribute zero uplift: {skipped}."
        )

    return {
        "status": "ready",
        "modelVersion": UPLIFT_MODEL_VERSION,
        "trainingMode": UPLIFT_TRAINING_MODE,
        "evidenceLevel": "observed",
        "evidenceSummary": EVIDENCE_SUMMARY,
        "baseValue": int(base_value),
        "upliftPercent": round(uplift_percent, 4),
        "treatedQuantileRange": _treated_quantile_range(base_value, low_percent, high_percent),
        "upliftValue": int(uplift_value),
        "finalValueRaw": int(final_value_raw),
        "finalValueGuardrailed": int(final_value_guardrailed),
        "ceilingFlag": final_value_raw > practical_ceiling,
        "plannedFlags": planned_flags,
        "topUpliftDrivers": sorted(driver_rows, key=lambda item: abs(item["value"]), reverse=True),
        "observedShare": 1.0,
        "dataSources": {
            "hrmBuildingPermits": (
                f"HRM geolocated building permits joined to PVSC dwellings within 30 m — "
                f"{treated_total} treated repeat-sale pairs across the ready categories"
            ),
            "pvscRepeatSales": (
                f"PVSC Parcel Sales History repeat-sale pairs, time-adjusted to {export['baselineMonth']} — "
                f"{control_pairs} control pairs with no permit between sales"
            ),
        },
        "rowCounts": row_counts,
        "methodNotes": method_notes,
    }
