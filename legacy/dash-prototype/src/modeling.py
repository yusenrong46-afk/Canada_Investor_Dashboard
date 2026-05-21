from __future__ import annotations

# Legacy synthetic-data modeling prototype retained for historical reference only.
# The live product uses the Python services under artifacts/model-service/.

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

NEIGHBOURHOODS = [
    "Kitsilano",
    "Mount Pleasant",
    "Kerrisdale",
    "Downtown",
    "West End",
    "Renfrew-Collingwood",
    "Marpole",
    "Point Grey",
    "Dunbar Southlands",
    "Fraserview",
]

PROPERTY_TYPES = ["Detached", "Townhouse", "Condo", "Duplex"]

NUMERIC_FEATURES = [
    "living_area_sqft",
    "lot_size_sqft",
    "bedrooms",
    "bathrooms",
    "age_years",
    "condition_score",
    "walk_score",
    "transit_score",
    "school_score",
    "interest_rate",
    "renovated_kitchen",
    "renovated_bathrooms",
    "has_legal_suite",
    "energy_efficient",
    "curb_appeal_boost",
    "deferred_maintenance",
    "roof_issue",
    "permit_closed_recently",
]

CATEGORICAL_FEATURES = ["neighbourhood", "property_type"]
ALL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

_NEIGHBOURHOOD_BASE_PSF = {
    "Kitsilano": 980,
    "Mount Pleasant": 920,
    "Kerrisdale": 1040,
    "Downtown": 940,
    "West End": 930,
    "Renfrew-Collingwood": 790,
    "Marpole": 850,
    "Point Grey": 1120,
    "Dunbar Southlands": 1020,
    "Fraserview": 780,
}

_TYPE_MULTIPLIER = {
    "Detached": 1.15,
    "Townhouse": 1.00,
    "Condo": 0.88,
    "Duplex": 1.05,
}


@dataclass(frozen=True)
class Action:
    id: str
    label: str
    category: str
    cost: float
    months: int
    changes: dict[str, float]
    note: str


ACTION_CATALOG: list[Action] = [
    Action(
        id="kitchen_refresh",
        label="Kitchen refresh",
        category="upgrade",
        cost=55_000,
        months=2,
        changes={"renovated_kitchen": 1, "condition_score": 4.1},
        note="Cabinet, countertops, and appliance package.",
    ),
    Action(
        id="bathroom_upgrade",
        label="Bathroom upgrade",
        category="upgrade",
        cost=32_000,
        months=1,
        changes={"renovated_bathrooms": 1, "condition_score": 3.9},
        note="Main bathroom + powder room refresh.",
    ),
    Action(
        id="add_legal_suite",
        label="Add legal suite",
        category="upgrade",
        cost=170_000,
        months=5,
        changes={"has_legal_suite": 1, "living_area_sqft": 260, "permit_closed_recently": 1},
        note="Creates rental potential and resale premium.",
    ),
    Action(
        id="energy_retrofit",
        label="Energy retrofit",
        category="upgrade",
        cost=24_000,
        months=2,
        changes={"energy_efficient": 1, "condition_score": 3.7},
        note="Heat pump + envelope upgrades.",
    ),
    Action(
        id="curb_appeal",
        label="Curb appeal boost",
        category="upgrade",
        cost=12_000,
        months=1,
        changes={"curb_appeal_boost": 1, "condition_score": 3.6},
        note="Landscaping, paint touch-up, entry improvements.",
    ),
    Action(
        id="roof_repair",
        label="Roof repair",
        category="upgrade",
        cost=18_000,
        months=1,
        changes={"roof_issue": 0, "condition_score": 3.8},
        note="Removes major buyer discounting risk.",
    ),
    Action(
        id="maintenance_cleanup",
        label="Resolve deferred maintenance",
        category="upgrade",
        cost=15_000,
        months=1,
        changes={"deferred_maintenance": 0, "condition_score": 3.7},
        note="Fixes smaller defects buyers use to negotiate down.",
    ),
    Action(
        id="permit_closeout",
        label="Close open permit issues",
        category="upgrade",
        cost=4_000,
        months=1,
        changes={"permit_closed_recently": 1},
        note="Reduces transaction friction before listing.",
    ),
    Action(
        id="keep_deferred_maintenance",
        label="Keep deferred maintenance unresolved",
        category="drag",
        cost=0,
        months=0,
        changes={"deferred_maintenance": 1},
        note="Common value drag when owners skip fixes.",
    ),
    Action(
        id="postpone_roof_repair",
        label="Postpone roof repair",
        category="drag",
        cost=0,
        months=0,
        changes={"roof_issue": 1},
        note="Signals upcoming capital expense to buyers.",
    ),
]


@dataclass
class ModelArtifacts:
    pipeline: Pipeline
    feature_columns: list[str]
    mae: float
    dataset: pd.DataFrame
    baseline_profile: dict[str, Any]
    global_importance: pd.DataFrame


def _safe_ohe() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def generate_synthetic_vancouver_data(n_samples: int = 4500, random_state: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(random_state)

    neighbourhood = rng.choice(
        NEIGHBOURHOODS,
        size=n_samples,
        p=[0.12, 0.12, 0.08, 0.15, 0.13, 0.12, 0.1, 0.06, 0.06, 0.06],
    )
    property_type = rng.choice(PROPERTY_TYPES, size=n_samples, p=[0.34, 0.22, 0.3, 0.14])

    area_means = {"Detached": 2450, "Townhouse": 1650, "Condo": 980, "Duplex": 1850}
    living_area_sqft = np.array([rng.normal(area_means[t], 260) for t in property_type]).clip(450, 5000)

    lot_means = {"Detached": 4300, "Townhouse": 1900, "Condo": 0, "Duplex": 3100}
    lot_noise = np.array([rng.normal(lot_means[t], 450) for t in property_type])
    lot_size_sqft = np.where(property_type == "Condo", rng.normal(0, 40, n_samples), lot_noise).clip(0, 12000)

    bedrooms = np.clip(np.round(living_area_sqft / 620 + rng.normal(0, 0.7, n_samples)), 1, 8)
    bathrooms = np.clip(np.round((bedrooms / 1.5) + rng.normal(0, 0.4, n_samples), 1), 1, 6)
    age_years = np.clip(np.round(rng.gamma(shape=2.4, scale=14.0, size=n_samples)), 0, 120)

    condition_score = np.clip(3.8 - age_years / 65 + rng.normal(0, 0.5, n_samples), 1.2, 5.0)
    renovated_kitchen = rng.binomial(1, np.clip((condition_score - 1.8) / 3.8, 0.1, 0.9))
    renovated_bathrooms = rng.binomial(1, np.clip((condition_score - 1.7) / 3.5, 0.1, 0.9))
    has_legal_suite = np.where(property_type == "Detached", rng.binomial(1, 0.22, n_samples), rng.binomial(1, 0.08, n_samples))
    energy_efficient = rng.binomial(1, 0.34, n_samples)
    curb_appeal_boost = rng.binomial(1, 0.41, n_samples)
    deferred_maintenance = rng.binomial(1, np.clip((3.1 - condition_score) / 2.8, 0.05, 0.7))
    roof_issue = rng.binomial(1, np.clip((age_years - 25) / 120, 0.03, 0.52))
    permit_closed_recently = rng.binomial(1, 0.31, n_samples)

    walk_base = {
        "Downtown": 95,
        "West End": 93,
        "Kitsilano": 88,
        "Mount Pleasant": 86,
        "Kerrisdale": 78,
        "Renfrew-Collingwood": 76,
        "Marpole": 75,
        "Point Grey": 73,
        "Dunbar Southlands": 70,
        "Fraserview": 66,
    }
    transit_base = {
        "Downtown": 96,
        "West End": 92,
        "Kitsilano": 84,
        "Mount Pleasant": 85,
        "Kerrisdale": 72,
        "Renfrew-Collingwood": 74,
        "Marpole": 77,
        "Point Grey": 68,
        "Dunbar Southlands": 64,
        "Fraserview": 61,
    }
    school_base = {
        "Downtown": 73,
        "West End": 75,
        "Kitsilano": 86,
        "Mount Pleasant": 80,
        "Kerrisdale": 91,
        "Renfrew-Collingwood": 76,
        "Marpole": 78,
        "Point Grey": 92,
        "Dunbar Southlands": 90,
        "Fraserview": 72,
    }

    walk_score = np.clip(np.array([walk_base[n] for n in neighbourhood]) + rng.normal(0, 6, n_samples), 40, 99)
    transit_score = np.clip(np.array([transit_base[n] for n in neighbourhood]) + rng.normal(0, 7, n_samples), 30, 99)
    school_score = np.clip(np.array([school_base[n] for n in neighbourhood]) + rng.normal(0, 6, n_samples), 45, 99)
    interest_rate = np.clip(rng.normal(3.8, 0.6, n_samples), 2.0, 6.0)

    base_psf = np.array([_NEIGHBOURHOOD_BASE_PSF[n] for n in neighbourhood])
    type_multiplier = np.array([_TYPE_MULTIPLIER[t] for t in property_type])

    sale_price = (
        living_area_sqft * base_psf * type_multiplier
        + lot_size_sqft * 28
        + bedrooms * 24_000
        + bathrooms * 30_000
        + (condition_score - 3.0) * 85_000
        + renovated_kitchen * 72_000
        + renovated_bathrooms * 45_000
        + has_legal_suite * 165_000
        + energy_efficient * 26_000
        + curb_appeal_boost * 18_000
        - deferred_maintenance * 85_000
        - roof_issue * 60_000
        + permit_closed_recently * 20_000
        + walk_score * 3_200
        + transit_score * 2_100
        + school_score * 1_650
        - (interest_rate - 3.0) * 95_000
        + rng.normal(0, 95_000, n_samples)
    )
    sale_price = np.clip(sale_price, 450_000, 6_500_000)

    return pd.DataFrame(
        {
            "neighbourhood": neighbourhood,
            "property_type": property_type,
            "living_area_sqft": living_area_sqft.round(0),
            "lot_size_sqft": lot_size_sqft.round(0),
            "bedrooms": bedrooms.astype(int),
            "bathrooms": bathrooms.astype(float),
            "age_years": age_years.astype(int),
            "condition_score": condition_score.round(2),
            "walk_score": walk_score.round(0),
            "transit_score": transit_score.round(0),
            "school_score": school_score.round(0),
            "interest_rate": interest_rate.round(2),
            "renovated_kitchen": renovated_kitchen.astype(int),
            "renovated_bathrooms": renovated_bathrooms.astype(int),
            "has_legal_suite": has_legal_suite.astype(int),
            "energy_efficient": energy_efficient.astype(int),
            "curb_appeal_boost": curb_appeal_boost.astype(int),
            "deferred_maintenance": deferred_maintenance.astype(int),
            "roof_issue": roof_issue.astype(int),
            "permit_closed_recently": permit_closed_recently.astype(int),
            "sale_price": sale_price.round(0),
        }
    )


def _build_pipeline() -> Pipeline:
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), NUMERIC_FEATURES),
            ("cat", _safe_ohe(), CATEGORICAL_FEATURES),
        ],
        remainder="drop",
    )
    model = RandomForestRegressor(
        n_estimators=420,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1,
    )
    return Pipeline([("prep", preprocessor), ("model", model)])


def _default_profile(df: pd.DataFrame) -> dict[str, Any]:
    profile: dict[str, Any] = {}
    for col in CATEGORICAL_FEATURES:
        modes = df[col].mode(dropna=True)
        profile[col] = str(modes.iloc[0]) if not modes.empty else ""
    for col in NUMERIC_FEATURES:
        profile[col] = float(df[col].median())
    profile["living_area_sqft"] = float(np.round(profile["living_area_sqft"]))
    profile["lot_size_sqft"] = float(np.round(profile["lot_size_sqft"]))
    profile["bedrooms"] = float(np.round(profile["bedrooms"]))
    profile["bathrooms"] = float(np.round(profile["bathrooms"] * 2) / 2)
    return profile


def train_model(df: pd.DataFrame) -> ModelArtifacts:
    X = df[ALL_FEATURES].copy()
    y = df["sale_price"].copy()

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    pipeline = _build_pipeline()
    pipeline.fit(X_train, y_train)
    preds = pipeline.predict(X_test)
    mae = float(mean_absolute_error(y_test, preds))

    importance = permutation_importance(pipeline, X_test, y_test, n_repeats=7, random_state=42, n_jobs=1)
    importance_df = pd.DataFrame(
        {"feature": ALL_FEATURES, "importance": importance.importances_mean}
    ).sort_values("importance", ascending=False)

    return ModelArtifacts(
        pipeline=pipeline,
        feature_columns=ALL_FEATURES,
        mae=mae,
        dataset=df,
        baseline_profile=_default_profile(df),
        global_importance=importance_df,
    )


def sanitize_profile(raw_profile: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    profile = dict(fallback)
    profile.update(raw_profile or {})

    profile["neighbourhood"] = str(profile.get("neighbourhood", fallback["neighbourhood"]))
    if profile["neighbourhood"] not in NEIGHBOURHOODS:
        profile["neighbourhood"] = fallback["neighbourhood"]

    profile["property_type"] = str(profile.get("property_type", fallback["property_type"]))
    if profile["property_type"] not in PROPERTY_TYPES:
        profile["property_type"] = fallback["property_type"]

    numeric_clamps = {
        "living_area_sqft": (350.0, 7000.0),
        "lot_size_sqft": (0.0, 15000.0),
        "bedrooms": (1.0, 10.0),
        "bathrooms": (1.0, 8.0),
        "age_years": (0.0, 140.0),
        "condition_score": (1.0, 5.0),
        "walk_score": (20.0, 100.0),
        "transit_score": (20.0, 100.0),
        "school_score": (20.0, 100.0),
        "interest_rate": (1.0, 8.0),
        "renovated_kitchen": (0.0, 1.0),
        "renovated_bathrooms": (0.0, 1.0),
        "has_legal_suite": (0.0, 1.0),
        "energy_efficient": (0.0, 1.0),
        "curb_appeal_boost": (0.0, 1.0),
        "deferred_maintenance": (0.0, 1.0),
        "roof_issue": (0.0, 1.0),
        "permit_closed_recently": (0.0, 1.0),
    }

    for key, (low, high) in numeric_clamps.items():
        try:
            value = float(profile.get(key, fallback[key]))
        except (TypeError, ValueError):
            value = float(fallback[key])
        profile[key] = float(np.clip(value, low, high))

    profile["bedrooms"] = float(np.round(profile["bedrooms"]))
    profile["living_area_sqft"] = float(np.round(profile["living_area_sqft"]))
    profile["lot_size_sqft"] = float(np.round(profile["lot_size_sqft"]))
    profile["bathrooms"] = float(np.round(profile["bathrooms"] * 2.0) / 2.0)
    for key in [
        "renovated_kitchen",
        "renovated_bathrooms",
        "has_legal_suite",
        "energy_efficient",
        "curb_appeal_boost",
        "deferred_maintenance",
        "roof_issue",
        "permit_closed_recently",
    ]:
        profile[key] = float(int(round(profile[key])))

    return profile


def predict_price(profile: dict[str, Any], artifacts: ModelArtifacts) -> float:
    frame = pd.DataFrame([profile])[artifacts.feature_columns]
    return float(artifacts.pipeline.predict(frame)[0])


def format_cad(value: float) -> str:
    return f"${value:,.0f}"


def get_action(action_id: str) -> Action | None:
    for action in ACTION_CATALOG:
        if action.id == action_id:
            return action
    return None


def apply_actions(profile: dict[str, Any], action_ids: list[str]) -> tuple[dict[str, Any], float, int]:
    updated = dict(profile)
    total_cost = 0.0
    total_months = 0

    for action_id in action_ids:
        action = get_action(action_id)
        if action is None:
            continue
        for key, value in action.changes.items():
            if key in {"condition_score"}:
                updated[key] = float(np.clip(max(float(updated.get(key, 0)), float(value)), 1.0, 5.0))
            elif key in {"living_area_sqft", "lot_size_sqft"}:
                updated[key] = float(max(0.0, float(updated.get(key, 0)) + float(value)))
            else:
                updated[key] = float(value)
        total_cost += action.cost
        total_months += action.months

    return updated, total_cost, total_months


def simulate_scenario(
    base_profile: dict[str, Any],
    action_ids: list[str],
    artifacts: ModelArtifacts,
    known_current_value: float | None = None,
) -> dict[str, Any]:
    base_model_price = predict_price(base_profile, artifacts)
    post_profile, total_cost, total_months = apply_actions(base_profile, action_ids)
    post_model_price = predict_price(post_profile, artifacts)
    model_uplift = post_model_price - base_model_price

    anchor_value = known_current_value if known_current_value and known_current_value > 0 else base_model_price
    adjusted_post_price = anchor_value + model_uplift

    action_rows = []
    for action_id in action_ids:
        action = get_action(action_id)
        if action is None:
            continue
        single_profile, _, _ = apply_actions(base_profile, [action_id])
        single_uplift = predict_price(single_profile, artifacts) - base_model_price
        action_rows.append(
            {
                "action": action.label,
                "category": action.category,
                "cost": action.cost,
                "months": action.months,
                "estimated_uplift": single_uplift,
                "roi_ratio": (single_uplift / action.cost) if action.cost > 0 else np.nan,
                "note": action.note,
            }
        )

    return {
        "base_model_price": base_model_price,
        "anchor_value": anchor_value,
        "projected_value": adjusted_post_price,
        "uplift": model_uplift,
        "cost": total_cost,
        "months": total_months,
        "net_gain": model_uplift - total_cost,
        "action_rows": pd.DataFrame(action_rows),
        "post_profile": post_profile,
    }


def profile_factor_impacts(profile: dict[str, Any], artifacts: ModelArtifacts, top_n: int = 8) -> pd.DataFrame:
    base = predict_price(profile, artifacts)
    candidates = {
        "Renovated kitchen": ("renovated_kitchen", 1),
        "Renovated bathrooms": ("renovated_bathrooms", 1),
        "Legal suite": ("has_legal_suite", 1),
        "Energy efficient": ("energy_efficient", 1),
        "Curb appeal": ("curb_appeal_boost", 1),
        "Deferred maintenance": ("deferred_maintenance", 1),
        "Roof issue": ("roof_issue", 1),
        "Permit closed": ("permit_closed_recently", 1),
        "Condition +1": ("condition_score", min(5.0, profile["condition_score"] + 1)),
        "Condition -1": ("condition_score", max(1.0, profile["condition_score"] - 1)),
    }

    rows: list[dict[str, Any]] = []
    for label, (feature, value) in candidates.items():
        tweaked = dict(profile)
        tweaked[feature] = value
        delta = predict_price(tweaked, artifacts) - base
        rows.append({"factor": label, "delta": delta})

    out = pd.DataFrame(rows).sort_values("delta", ascending=False)
    return pd.concat([out.head(top_n // 2), out.tail(top_n // 2)]).drop_duplicates()


def recommend_plan(
    base_profile: dict[str, Any],
    target_price: float,
    budget: float,
    timeline_months: int,
    artifacts: ModelArtifacts,
    known_current_value: float | None = None,
) -> dict[str, Any]:
    candidate_actions = [a for a in ACTION_CATALOG if a.category == "upgrade"]
    baseline = simulate_scenario(base_profile, [], artifacts, known_current_value=known_current_value)
    base_value = baseline["anchor_value"]

    scored: list[dict[str, Any]] = []
    for action in candidate_actions:
        sim = simulate_scenario(base_profile, [action.id], artifacts, known_current_value=known_current_value)
        uplift = float(sim["uplift"])
        if uplift <= 0:
            continue
        scored.append(
            {
                "id": action.id,
                "label": action.label,
                "cost": action.cost,
                "months": action.months,
                "uplift": uplift,
                "net_gain": uplift - action.cost,
                "roi_ratio": uplift / action.cost if action.cost > 0 else np.nan,
                "score": (uplift / max(action.cost, 1)) + (uplift / max(action.months, 1)) / 180_000,
            }
        )

    ranked = sorted(scored, key=lambda x: x["score"], reverse=True)

    chosen: list[str] = []
    remaining_budget = float(max(0.0, budget))
    remaining_months = int(max(0, timeline_months))

    for row in ranked:
        if row["cost"] <= remaining_budget and row["months"] <= remaining_months:
            chosen.append(row["id"])
            remaining_budget -= row["cost"]
            remaining_months -= row["months"]

    plan = simulate_scenario(base_profile, chosen, artifacts, known_current_value=known_current_value)
    achievable = float(plan["projected_value"])
    confidence_buffer = artifacts.mae * 1.3

    if target_price <= achievable + confidence_buffer:
        status = "Likely achievable"
    elif target_price <= achievable + (artifacts.mae * 2.2):
        status = "Stretch target"
    else:
        status = "Unrealistic for current budget/timeline"

    plan_gap = target_price - achievable
    recommended_df = plan["action_rows"].sort_values("estimated_uplift", ascending=False)

    return {
        "status": status,
        "base_value": base_value,
        "target_price": target_price,
        "achievable_price": achievable,
        "plan_gap": plan_gap,
        "confidence_buffer": confidence_buffer,
        "recommended_actions": recommended_df,
        "plan_summary": plan,
    }
