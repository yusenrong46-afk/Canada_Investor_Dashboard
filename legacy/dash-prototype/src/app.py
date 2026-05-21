from __future__ import annotations

# Legacy Dash prototype retained for historical reference only.
# The live product runs from artifacts/home-value-planner, artifacts/api-server,
# and artifacts/model-service.

from typing import Any

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from dash import Dash, Input, Output, State, ctx, dash_table, dcc, html, no_update

from modeling import (
    ACTION_CATALOG,
    NEIGHBOURHOODS,
    PROPERTY_TYPES,
    format_cad,
    generate_synthetic_vancouver_data,
    predict_price,
    profile_factor_impacts,
    recommend_plan,
    sanitize_profile,
    simulate_scenario,
    train_model,
)

DATAFRAME = generate_synthetic_vancouver_data()
ARTIFACTS = train_model(DATAFRAME)

UPGRADE_ACTIONS = [action for action in ACTION_CATALOG if action.category == "upgrade"]
DRAG_ACTIONS = [action for action in ACTION_CATALOG if action.category == "drag"]
MEDIAN_PRICE = float(DATAFRAME["sale_price"].median())
PREMIUM_NEIGHBOURHOOD = (
    DATAFRAME.groupby("neighbourhood")["sale_price"].median().sort_values(ascending=False).index[0]
)
PREMIUM_NEIGHBOURHOOD_PRICE = float(
    DATAFRAME.groupby("neighbourhood")["sale_price"].median().sort_values(ascending=False).iloc[0]
)

PROFILE_BOOLEAN_FEATURES = [
    "renovated_kitchen",
    "renovated_bathrooms",
    "has_legal_suite",
    "energy_efficient",
    "curb_appeal_boost",
    "permit_closed_recently",
]
PROFILE_RISK_FEATURES = ["deferred_maintenance", "roof_issue"]

FEATURE_LABELS = {
    "renovated_kitchen": "Kitchen renovated",
    "renovated_bathrooms": "Bathrooms renovated",
    "has_legal_suite": "Legal suite",
    "energy_efficient": "Energy efficient",
    "curb_appeal_boost": "Strong curb appeal",
    "permit_closed_recently": "Recent permits closed",
    "deferred_maintenance": "Deferred maintenance",
    "roof_issue": "Roof issue",
}

SCATTER_SAMPLE = DATAFRAME.sample(min(320, len(DATAFRAME)), random_state=21)
NEIGHBOURHOOD_MEDIANS = (
    DATAFRAME.groupby("neighbourhood", as_index=False)["sale_price"].median().sort_values("sale_price", ascending=False)
)


def _build_profile(
    neighbourhood: str,
    property_type: str,
    living_area_sqft: float,
    lot_size_sqft: float,
    bedrooms: float,
    bathrooms: float,
    age_years: float,
    condition_score: float,
    walk_score: float,
    transit_score: float,
    school_score: float,
    interest_rate: float,
    current_features: list[str] | None,
    risk_features: list[str] | None,
) -> dict[str, Any]:
    profile: dict[str, Any] = {
        "neighbourhood": neighbourhood,
        "property_type": property_type,
        "living_area_sqft": living_area_sqft,
        "lot_size_sqft": lot_size_sqft,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "age_years": age_years,
        "condition_score": condition_score,
        "walk_score": walk_score,
        "transit_score": transit_score,
        "school_score": school_score,
        "interest_rate": interest_rate,
    }
    current_set = set(current_features or [])
    risk_set = set(risk_features or [])

    for key in PROFILE_BOOLEAN_FEATURES:
        profile[key] = 1 if key in current_set else 0
    for key in PROFILE_RISK_FEATURES:
        profile[key] = 1 if key in risk_set else 0

    return sanitize_profile(profile, ARTIFACTS.baseline_profile)


def _status_class(status: str) -> str:
    if "Likely" in status:
        return "status-pill is-good"
    if "Stretch" in status:
        return "status-pill is-mid"
    return "status-pill is-bad"


def _normalize_path(pathname: str | None) -> str:
    if pathname in {None, "", "/", "/overview"}:
        return "/overview"
    if pathname in {"/value-drivers", "/sell-plan"}:
        return pathname
    return "/overview"


def _coerce_float(value: Any, fallback: float, minimum: float | None = None, maximum: float | None = None) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        out = float(fallback)
    if minimum is not None:
        out = max(minimum, out)
    if maximum is not None:
        out = min(maximum, out)
    return out


def _coerce_int(value: Any, fallback: int, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        out = int(float(value))
    except (TypeError, ValueError):
        out = int(fallback)
    if minimum is not None:
        out = max(minimum, out)
    if maximum is not None:
        out = min(maximum, out)
    return out


def _default_profile_store() -> dict[str, Any]:
    baseline = ARTIFACTS.baseline_profile
    return {
        "neighbourhood": baseline["neighbourhood"],
        "property_type": baseline["property_type"],
        "living_area_sqft": float(baseline["living_area_sqft"]),
        "lot_size_sqft": float(baseline["lot_size_sqft"]),
        "bedrooms": float(baseline["bedrooms"]),
        "bathrooms": float(baseline["bathrooms"]),
        "age_years": float(baseline["age_years"]),
        "condition_score": float(baseline["condition_score"]),
        "walk_score": float(baseline["walk_score"]),
        "transit_score": float(baseline["transit_score"]),
        "school_score": float(baseline["school_score"]),
        "interest_rate": float(baseline["interest_rate"]),
        "current_features": [key for key in PROFILE_BOOLEAN_FEATURES if int(baseline.get(key, 0)) == 1],
        "risk_features": [key for key in PROFILE_RISK_FEATURES if int(baseline.get(key, 0)) == 1],
        "known_current_value": None,
    }


def _default_scenario_store() -> dict[str, Any]:
    return {"upgrades": [], "drags": []}


def _default_planner_store() -> dict[str, Any]:
    return {"target_price": 2_000_000, "budget": 120_000, "months": 5}


def _coerce_profile_store(data: dict[str, Any] | None) -> dict[str, Any]:
    default = _default_profile_store()
    if not isinstance(data, dict):
        return default

    merged = {**default, **data}
    merged["neighbourhood"] = merged["neighbourhood"] if merged["neighbourhood"] in NEIGHBOURHOODS else default["neighbourhood"]
    merged["property_type"] = merged["property_type"] if merged["property_type"] in PROPERTY_TYPES else default["property_type"]
    merged["living_area_sqft"] = _coerce_float(merged.get("living_area_sqft"), default["living_area_sqft"], minimum=350)
    merged["lot_size_sqft"] = _coerce_float(merged.get("lot_size_sqft"), default["lot_size_sqft"], minimum=0)
    merged["bedrooms"] = _coerce_float(merged.get("bedrooms"), default["bedrooms"], minimum=1, maximum=10)
    merged["bathrooms"] = _coerce_float(merged.get("bathrooms"), default["bathrooms"], minimum=1, maximum=8)
    merged["age_years"] = _coerce_float(merged.get("age_years"), default["age_years"], minimum=0, maximum=140)
    merged["condition_score"] = _coerce_float(merged.get("condition_score"), default["condition_score"], minimum=1, maximum=5)
    merged["walk_score"] = _coerce_float(merged.get("walk_score"), default["walk_score"], minimum=20, maximum=100)
    merged["transit_score"] = _coerce_float(merged.get("transit_score"), default["transit_score"], minimum=20, maximum=100)
    merged["school_score"] = _coerce_float(merged.get("school_score"), default["school_score"], minimum=20, maximum=100)
    merged["interest_rate"] = _coerce_float(merged.get("interest_rate"), default["interest_rate"], minimum=1.5, maximum=8)

    merged["current_features"] = [
        feature for feature in list(merged.get("current_features") or []) if feature in PROFILE_BOOLEAN_FEATURES
    ]
    merged["risk_features"] = [
        feature for feature in list(merged.get("risk_features") or []) if feature in PROFILE_RISK_FEATURES
    ]

    known_value = merged.get("known_current_value")
    if known_value in {None, ""}:
        merged["known_current_value"] = None
    else:
        parsed = _coerce_float(known_value, 0.0, minimum=0)
        merged["known_current_value"] = parsed if parsed > 0 else None

    return merged


def _coerce_scenario_store(data: dict[str, Any] | None) -> dict[str, Any]:
    default = _default_scenario_store()
    if not isinstance(data, dict):
        return default
    return {
        "upgrades": [item for item in list(data.get("upgrades") or []) if any(action.id == item for action in UPGRADE_ACTIONS)],
        "drags": [item for item in list(data.get("drags") or []) if any(action.id == item for action in DRAG_ACTIONS)],
    }


def _coerce_planner_store(data: dict[str, Any] | None) -> dict[str, Any]:
    default = _default_planner_store()
    if not isinstance(data, dict):
        return default
    return {
        "target_price": _coerce_float(data.get("target_price"), default["target_price"], minimum=0),
        "budget": _coerce_float(data.get("budget"), default["budget"], minimum=0),
        "months": _coerce_int(data.get("months"), default["months"], minimum=0, maximum=24),
    }


def _profile_from_store(profile_data: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]]:
    store = _coerce_profile_store(profile_data)
    profile = _build_profile(
        neighbourhood=store["neighbourhood"],
        property_type=store["property_type"],
        living_area_sqft=store["living_area_sqft"],
        lot_size_sqft=store["lot_size_sqft"],
        bedrooms=store["bedrooms"],
        bathrooms=store["bathrooms"],
        age_years=store["age_years"],
        condition_score=store["condition_score"],
        walk_score=store["walk_score"],
        transit_score=store["transit_score"],
        school_score=store["school_score"],
        interest_rate=store["interest_rate"],
        current_features=store["current_features"],
        risk_features=store["risk_features"],
    )
    return store, profile


def _polish_figure(fig: go.Figure) -> go.Figure:
    fig.update_layout(
        margin={"l": 18, "r": 18, "t": 58, "b": 24},
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        hovermode="closest",
        font={"family": "Inter, Segoe UI, sans-serif", "color": "#17324d"},
        title={"x": 0.02, "xanchor": "left", "font": {"family": "DM Sans, Segoe UI, sans-serif", "size": 18}},
        coloraxis_showscale=False,
        legend={
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.02,
            "xanchor": "left",
            "x": 0.0,
            "bgcolor": "rgba(0,0,0,0)",
        },
    )
    fig.update_xaxes(showgrid=True, gridcolor="rgba(22,51,82,0.10)", zeroline=False)
    fig.update_yaxes(showgrid=False, zeroline=False)
    return fig


def _metric_card(label: str, value: str, note: str):
    return html.Div(
        className="metric-card",
        children=[
            html.Div(label, className="metric-card-label"),
            html.Div(value, className="metric-card-value"),
            html.Div(note, className="metric-card-note"),
        ],
    )


def _panel(title: str, body: str, children: Any, class_name: str = "panel-card span-12"):
    return html.Section(
        className=class_name,
        children=[
            html.Div(
                className="panel-card-head",
                children=[
                    html.H3(title),
                    html.P(body),
                ],
            ),
            html.Div(className="panel-card-body", children=children),
        ],
    )


def _empty_figure(title: str) -> go.Figure:
    fig = go.Figure()
    fig.update_layout(title=title)
    return _polish_figure(fig)


def _valuation_context(profile_data: dict[str, Any] | None) -> dict[str, Any]:
    store, profile = _profile_from_store(profile_data)
    predicted = predict_price(profile, ARTIFACTS)
    low = predicted - (ARTIFACTS.mae * 1.2)
    high = predicted + (ARTIFACTS.mae * 1.2)
    known_anchor = store["known_current_value"]
    anchor = known_anchor if known_anchor and known_anchor > 0 else predicted
    impact_df = profile_factor_impacts(profile, ARTIFACTS)

    positive_levers = impact_df[impact_df["delta"] > 0].sort_values("delta", ascending=False).head(3)
    negative_levers = impact_df[impact_df["delta"] < 0].sort_values("delta", ascending=True).head(3)

    return {
        "store": store,
        "profile": profile,
        "predicted": predicted,
        "low": low,
        "high": high,
        "anchor": anchor,
        "anchor_note": (
            f"Using your known value as anchor: {format_cad(anchor)}"
            if known_anchor and known_anchor > 0
            else f"Using model estimate as anchor: {format_cad(anchor)}"
        ),
        "impact_df": impact_df,
        "positive_levers": positive_levers,
        "negative_levers": negative_levers,
    }


def _impact_figure(impact_df: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        impact_df.sort_values("delta"),
        x="delta",
        y="factor",
        color="delta",
        orientation="h",
        title="Home-specific factors that move value",
        color_continuous_scale="RdYlGn",
    )
    return _polish_figure(fig)


def _neighbourhood_figure(selected_neighbourhood: str) -> go.Figure:
    plot_df = NEIGHBOURHOOD_MEDIANS.sort_values("sale_price", ascending=True)
    colors = ["#2b7de9" if row == selected_neighbourhood else "#c9d8e8" for row in plot_df["neighbourhood"]]
    fig = px.bar(
        plot_df,
        x="sale_price",
        y="neighbourhood",
        orientation="h",
        title="Neighbourhood median resale values",
    )
    fig.update_traces(marker_color=colors, hovertemplate="%{y}: %{x:$,.0f}<extra></extra>")
    fig.update_xaxes(title="Median value (CAD)")
    fig.update_yaxes(title=None)
    return _polish_figure(fig)


def _living_area_figure(value_ctx: dict[str, Any]) -> go.Figure:
    fig = px.scatter(
        SCATTER_SAMPLE,
        x="living_area_sqft",
        y="sale_price",
        color="property_type",
        size="bedrooms",
        hover_data={"neighbourhood": True, "bathrooms": True, "sale_price": ":,.0f"},
        title="Living area vs resale value",
        color_discrete_sequence=["#1d4ed8", "#14b8a6", "#fb923c", "#8b5cf6"],
    )
    fig.add_trace(
        go.Scatter(
            x=[value_ctx["store"]["living_area_sqft"]],
            y=[value_ctx["anchor"]],
            mode="markers",
            marker={
                "size": 16,
                "color": "#0f172a",
                "line": {"color": "#ffffff", "width": 3},
                "symbol": "diamond",
            },
            name="Selected home",
            hovertemplate=(
                f"{value_ctx['store']['neighbourhood']} {value_ctx['store']['property_type']}<br>"
                f"Area: {value_ctx['store']['living_area_sqft']:,.0f} sqft<br>"
                f"Anchor: {format_cad(value_ctx['anchor'])}<extra></extra>"
            ),
        )
    )
    fig.update_traces(selector={"mode": "markers"}, marker={"opacity": 0.68})
    fig.update_xaxes(title="Living area (sqft)")
    fig.update_yaxes(title="Sale price (CAD)")
    return _polish_figure(fig)


def _sidebar_summary(profile_data: dict[str, Any] | None):
    value_ctx = _valuation_context(profile_data)
    store = value_ctx["store"]
    return html.Div(
        className="sidebar-summary-card",
        children=[
            html.Div("Selected home", className="sidebar-summary-label"),
            html.Div(store["neighbourhood"], className="sidebar-summary-title"),
            html.Div(
                f"{store['property_type']} · {store['living_area_sqft']:,.0f} sqft · "
                f"{store['bedrooms']:.0f} bd · {store['bathrooms']:.1f} ba",
                className="sidebar-summary-meta",
            ),
            html.Div(format_cad(value_ctx["anchor"]), className="sidebar-summary-value"),
            html.Div(value_ctx["anchor_note"], className="sidebar-summary-note"),
        ],
    )


def _chip_row(values: list[str], empty_label: str, tone: str):
    if not values:
        return html.Div(html.Span(empty_label, className=f"chip chip--{tone}"), className="chip-row")
    return html.Div(
        [html.Span(FEATURE_LABELS[value], className=f"chip chip--{tone}") for value in values],
        className="chip-row",
    )


def _overview_page(profile_data: dict[str, Any] | None):
    value_ctx = _valuation_context(profile_data)
    store = value_ctx["store"]

    starter_card = html.Div(
        className="starter-card",
        children=[
            html.Div("Step 1", className="starter-badge"),
            html.H3("Estimate your home's baseline value"),
            html.P(
                "Use the top-right Edit Home Profile button first. Once your basics are right, the rest of the product becomes easier to trust."
            ),
            html.Ul(
                className="starter-list",
                children=[
                    html.Li("Confirm neighbourhood, property type, and area"),
                    html.Li("Set known current value if you already have an appraisal"),
                    html.Li("Mark strengths and drags before testing improvements"),
                ],
            ),
            html.Div("Then continue to Value Drivers to test what changes your sale price.", className="starter-note"),
        ],
    )

    snapshot_body = html.Div(
        className="snapshot-card",
        children=[
            html.Div(
                className="snapshot-meta-grid",
                children=[
                    html.Div(
                        className="snapshot-meta-item",
                        children=[html.Span("Condition"), html.Strong(f"{store['condition_score']:.1f}/5.0")],
                    ),
                    html.Div(
                        className="snapshot-meta-item",
                        children=[html.Span("Walk / Transit"), html.Strong(f"{store['walk_score']:.0f} / {store['transit_score']:.0f}")],
                    ),
                    html.Div(
                        className="snapshot-meta-item",
                        children=[html.Span("School score"), html.Strong(f"{store['school_score']:.0f}")],
                    ),
                    html.Div(
                        className="snapshot-meta-item",
                        children=[html.Span("Rate assumption"), html.Strong(f"{store['interest_rate']:.1f}%")],
                    ),
                ],
            ),
            html.Div("Current strengths", className="snapshot-section-label"),
            _chip_row(store["current_features"], "No extra strengths selected", "good"),
            html.Div("Current drags", className="snapshot-section-label"),
            _chip_row(store["risk_features"], "No major drags selected", "warn"),
        ],
    )

    return html.Div(
        className="page-view",
        children=[
            html.Div(
                className="page-header",
                children=[
                    html.Div("Step 1: Estimate", className="page-eyebrow"),
                    html.H1("Know your starting price before making upgrades"),
                    html.P(
                        "This page gives you the baseline valuation. Think of it as your starting line before improvement decisions."
                    ),
                ],
            ),
            html.Div(
                className="metric-grid metric-grid--four",
                children=[
                    _metric_card("Estimated current value", format_cad(value_ctx["predicted"]), "Your current expected resale price"),
                    _metric_card(
                        "Confidence range",
                        f"{format_cad(value_ctx['low'])} - {format_cad(value_ctx['high'])}",
                        "Reasonable band for this estimate",
                    ),
                    _metric_card("Current anchor", format_cad(value_ctx["anchor"]), value_ctx["anchor_note"]),
                    _metric_card(
                        "Top benchmark",
                        PREMIUM_NEIGHBOURHOOD,
                        f"Median: {format_cad(PREMIUM_NEIGHBOURHOOD_PRICE)}",
                    ),
                ],
            ),
            html.Div(
                className="content-grid",
                children=[
                    _panel(
                        "Start here",
                        "A quick checklist so first-time users know what to do before exploring charts.",
                        starter_card,
                        class_name="panel-card span-5",
                    ),
                    _panel(
                        "How your home compares in the market",
                        "Your home is highlighted against the broader Vancouver sample to show where it sits today.",
                        dcc.Graph(figure=_living_area_figure(value_ctx), config={"displayModeBar": False, "responsive": True}),
                        class_name="panel-card span-7",
                    ),
                    _panel(
                        "Neighbourhood context",
                        "Compare your selected neighbourhood to city-wide median values.",
                        dcc.Graph(figure=_neighbourhood_figure(store["neighbourhood"]), config={"displayModeBar": False, "responsive": True}),
                        class_name="panel-card span-6",
                    ),
                    _panel(
                        "Profile assumptions in plain English",
                        "These are the assumptions your estimate currently depends on.",
                        snapshot_body,
                        class_name="panel-card span-6",
                    ),
                ],
            ),
        ],
    )


def _drivers_summary_card(value_ctx: dict[str, Any]):
    positive_levers = value_ctx["positive_levers"]
    negative_levers = value_ctx["negative_levers"]
    store = value_ctx["store"]

    def _summary_rows(frame: pd.DataFrame, empty: str):
        if frame.empty:
            return [html.Div(empty, className="summary-empty")]
        return [
            html.Div(
                className="summary-list-item",
                children=[
                    html.Span(row["factor"]),
                    html.Strong(f"{'+' if row['delta'] >= 0 else '-'}{format_cad(abs(row['delta']))}"),
                ],
            )
            for _, row in frame.iterrows()
        ]

    return html.Div(
        className="drivers-summary-card",
        children=[
            html.Div(
                className="summary-stat-grid",
                children=[
                    html.Div(className="summary-stat", children=[html.Span("Condition"), html.Strong(f"{store['condition_score']:.1f}/5")]),
                    html.Div(className="summary-stat", children=[html.Span("Walk"), html.Strong(f"{store['walk_score']:.0f}")]),
                    html.Div(className="summary-stat", children=[html.Span("Transit"), html.Strong(f"{store['transit_score']:.0f}")]),
                ],
            ),
            html.Div("Current strengths", className="summary-label"),
            _chip_row(store["current_features"], "No strengths selected", "good"),
            html.Div("Current drags", className="summary-label"),
            _chip_row(store["risk_features"], "No active drags selected", "warn"),
            html.Div("Strongest upside levers", className="summary-label"),
            html.Div(_summary_rows(positive_levers, "No uplift levers found."), className="summary-list"),
            html.Div("Strongest downside risks", className="summary-label"),
            html.Div(_summary_rows(negative_levers, "No downside risks found."), className="summary-list"),
        ],
    )


def _scenario_context(profile_data: dict[str, Any] | None, scenario_data: dict[str, Any] | None) -> dict[str, Any]:
    value_ctx = _valuation_context(profile_data)
    scenario_store = _coerce_scenario_store(scenario_data)
    selected_ids = list(dict.fromkeys(scenario_store["upgrades"] + scenario_store["drags"]))
    simulation = simulate_scenario(
        value_ctx["profile"],
        selected_ids,
        ARTIFACTS,
        known_current_value=value_ctx["store"]["known_current_value"],
    )
    action_rows = simulation["action_rows"].copy()

    if not action_rows.empty:
        action_rows["cost_display"] = action_rows["cost"].map(format_cad)
        action_rows["uplift_display"] = action_rows["estimated_uplift"].map(format_cad)
        action_rows["roi_display"] = action_rows["roi_ratio"].map(lambda value: f"{value:.2f}x" if pd.notna(value) else "n/a")
        table_data = action_rows.to_dict("records")
    else:
        table_data = []

    net_gain = simulation["net_gain"]
    net_text = format_cad(net_gain) if net_gain >= 0 else f"-{format_cad(abs(net_gain))}"

    return {
        "store": scenario_store,
        "simulation": simulation,
        "table_data": table_data,
        "chart": _actions_figure(action_rows),
        "projected_value": format_cad(simulation["projected_value"]),
        "uplift": format_cad(simulation["uplift"]),
        "cost": format_cad(simulation["cost"]),
        "net": net_text,
        "value_ctx": value_ctx,
    }


def _actions_figure(actions: pd.DataFrame) -> go.Figure:
    if actions.empty:
        return _empty_figure("No scenario actions selected")
    plot_df = actions.copy()
    plot_df["Value Impact (CAD)"] = plot_df["estimated_uplift"]
    plot_df = plot_df.sort_values("Value Impact (CAD)", ascending=True)
    fig = px.bar(
        plot_df,
        x="Value Impact (CAD)",
        y="action",
        color="Value Impact (CAD)",
        orientation="h",
        color_continuous_scale="RdYlGn",
        title="Estimated action impact on sale price",
    )
    return _polish_figure(fig)


def _value_drivers_page(profile_data: dict[str, Any] | None, scenario_data: dict[str, Any] | None):
    value_ctx = _valuation_context(profile_data)
    scenario_ctx = _scenario_context(profile_data, scenario_data)

    global_factors = ARTIFACTS.global_importance.head(12).sort_values("importance", ascending=True)
    global_fig = px.bar(
        global_factors,
        x="importance",
        y="feature",
        orientation="h",
        title="Global pricing levers in the model",
        color="importance",
        color_continuous_scale="Blues",
    )
    global_fig = _polish_figure(global_fig)

    controls = html.Div(
        className="controls-stack",
        children=[
            html.Div(
                className="control-field",
                children=[
                    html.Label("Planned upgrades"),
                    dcc.Checklist(
                        id="scenario-upgrades",
                        options=[{"label": f"{action.label} ({format_cad(action.cost)})", "value": action.id} for action in UPGRADE_ACTIONS],
                        value=scenario_ctx["store"]["upgrades"],
                        className="checklist checklist--light",
                    ),
                ],
            ),
            html.Div(
                className="control-field",
                children=[
                    html.Label("Possible drags you keep"),
                    dcc.Checklist(
                        id="scenario-drags",
                        options=[{"label": action.label, "value": action.id} for action in DRAG_ACTIONS],
                        value=scenario_ctx["store"]["drags"],
                        className="checklist checklist--light",
                    ),
                ],
            ),
        ],
    )

    return html.Div(
        className="page-view",
        children=[
            html.Div(
                className="page-header",
                children=[
                    html.Div("Step 2: Improve", className="page-eyebrow"),
                    html.H1("See what increases value before spending money"),
                    html.P(
                        "Pick upgrades, keep or remove drags, and instantly see how your projected sale price changes."
                    ),
                ],
            ),
            html.Div(
                className="content-grid",
                children=[
                    _panel(
                        "What moves your price the most",
                        "Positive bars lift value. Negative bars reduce value. This is specific to your selected home profile.",
                        dcc.Graph(figure=_impact_figure(value_ctx["impact_df"]), config={"displayModeBar": False, "responsive": True}),
                        class_name="panel-card span-7",
                    ),
                    _panel(
                        "Choose what you will change",
                        "Select upgrades and any unresolved issues you plan to leave as-is.",
                        controls,
                        class_name="panel-card span-5",
                    ),
                    _panel(
                        "Model-wide value levers",
                        "These are the strongest pricing drivers across the full Vancouver training sample.",
                        dcc.Graph(figure=global_fig, config={"displayModeBar": False, "responsive": True}),
                        class_name="panel-card span-6",
                    ),
                    _panel(
                        "Why this matters",
                        "This summary translates model behavior into plain language so you can prioritize practical actions first.",
                        _drivers_summary_card(value_ctx),
                        class_name="panel-card span-6",
                    ),
                ],
            ),
            html.Div(
                className="metric-grid metric-grid--four metric-grid--scenario",
                children=[
                    _metric_card("Projected price", scenario_ctx["projected_value"], "With selected upgrades and drags"),
                    _metric_card("Value uplift", scenario_ctx["uplift"], "Model uplift versus the current anchor"),
                    _metric_card("Upgrade cost", scenario_ctx["cost"], "Estimated capital required"),
                    _metric_card("Net gain", scenario_ctx["net"], "Value uplift minus upgrade cost"),
                ],
            ),
            html.Div(
                className="content-grid",
                children=[
                    _panel(
                        "Impact of selected actions",
                        "Each bar estimates standalone sale-price impact for one selected action.",
                        dcc.Graph(figure=scenario_ctx["chart"], config={"displayModeBar": False, "responsive": True}),
                        class_name="panel-card span-12",
                    ),
                    _panel(
                        "Advanced action details",
                        "Open this table if you want full ROI and timeline details for each selected action.",
                        html.Details(
                            className="advanced-details",
                            children=[
                                html.Summary("Show detailed action table"),
                                dash_table.DataTable(
                                    id="scenario-table",
                                    columns=[
                                        {"name": "Action", "id": "action"},
                                        {"name": "Category", "id": "category"},
                                        {"name": "Cost", "id": "cost_display"},
                                        {"name": "Uplift", "id": "uplift_display"},
                                        {"name": "ROI", "id": "roi_display"},
                                        {"name": "Timeline (months)", "id": "months"},
                                    ],
                                    data=scenario_ctx["table_data"],
                                    page_size=8,
                                    **TABLE_STYLE,
                                ),
                            ],
                        ),
                        class_name="panel-card span-12",
                    ),
                ],
            ),
        ],
    )


def _plan_context(profile_data: dict[str, Any] | None, planner_data: dict[str, Any] | None) -> dict[str, Any]:
    value_ctx = _valuation_context(profile_data)
    planner_store = _coerce_planner_store(planner_data)
    plan = recommend_plan(
        value_ctx["profile"],
        target_price=planner_store["target_price"],
        budget=planner_store["budget"],
        timeline_months=planner_store["months"],
        artifacts=ARTIFACTS,
        known_current_value=value_ctx["store"]["known_current_value"],
    )

    recommended_df = plan["recommended_actions"].copy()
    if recommended_df.empty:
        recommended_chart = _empty_figure("No feasible actions within the current budget and timeline")
        table_data: list[dict[str, Any]] = []
    else:
        recommended_df["net_gain"] = recommended_df["estimated_uplift"] - recommended_df["cost"]
        recommended_df["cost_display"] = recommended_df["cost"].map(format_cad)
        recommended_df["uplift_display"] = recommended_df["estimated_uplift"].map(format_cad)
        recommended_df["net_display"] = recommended_df["net_gain"].map(format_cad)
        recommended_chart = px.bar(
            recommended_df.sort_values("estimated_uplift"),
            x="estimated_uplift",
            y="action",
            color="net_gain",
            orientation="h",
            title="Recommended plan uplift by action",
            color_continuous_scale="Tealgrn",
        )
        recommended_chart = _polish_figure(recommended_chart)
        table_data = recommended_df.to_dict("records")

    comparison_df = pd.DataFrame(
        {
            "Stage": ["Current anchor", "Achievable with plan", "Target sale price"],
            "Value": [plan["base_value"], plan["achievable_price"], plan["target_price"]],
            "Type": ["Current", "Plan", "Target"],
        }
    )
    comparison_fig = px.bar(
        comparison_df,
        x="Stage",
        y="Value",
        color="Type",
        title="Current anchor vs achievable outcome vs target",
        color_discrete_map={"Current": "#9fb4c9", "Plan": "#2b7de9", "Target": "#f97316"},
    )
    comparison_fig = _polish_figure(comparison_fig)
    comparison_fig.update_layout(showlegend=False)
    comparison_fig.update_yaxes(title="Value (CAD)")

    gap = float(plan["plan_gap"])
    if gap <= 0:
        gap_note = f"Inside range by about {format_cad(abs(gap))}."
        gap_value = format_cad(abs(gap))
    else:
        gap_note = f"Short by about {format_cad(gap)}."
        gap_value = format_cad(gap)

    summary = html.Div(
        className="plan-summary",
        children=[
            html.Span(plan["status"], className=_status_class(plan["status"])),
            html.P(
                f"Base anchor: {format_cad(plan['base_value'])}. With the current budget and timeline, "
                f"the model expects an achievable sale price around {format_cad(plan['achievable_price'])}."
            ),
            html.P(
                f"Target price: {format_cad(plan['target_price'])}. "
                f"Confidence buffer: +/- {format_cad(plan['confidence_buffer'])}. {gap_note}"
            ),
        ],
    )

    return {
        "store": planner_store,
        "plan": plan,
        "table_data": table_data,
        "comparison_fig": comparison_fig,
        "recommended_fig": recommended_chart,
        "summary": summary,
        "status": plan["status"],
        "target_value": format_cad(plan["target_price"]),
        "achievable_value": format_cad(plan["achievable_price"]),
        "gap_value": gap_value,
        "gap_note": gap_note,
    }


def _sell_plan_page(profile_data: dict[str, Any] | None, planner_data: dict[str, Any] | None):
    plan_ctx = _plan_context(profile_data, planner_data)

    planner_inputs = html.Div(
        className="planner-form-grid",
        children=[
            html.Div(
                className="control-field",
                children=[
                    html.Label("Target sale price"),
                    dcc.Input(
                        id="planner-target-price",
                        type="number",
                        min=0,
                        step=1000,
                        value=plan_ctx["store"]["target_price"],
                    ),
                ],
            ),
            html.Div(
                className="control-field",
                children=[
                    html.Label("Renovation budget"),
                    dcc.Input(
                        id="planner-budget",
                        type="number",
                        min=0,
                        step=1000,
                        value=plan_ctx["store"]["budget"],
                    ),
                ],
            ),
            html.Div(
                className="control-field",
                children=[
                    html.Label("Timeline (months)"),
                    dcc.Input(
                        id="planner-months",
                        type="number",
                        min=0,
                        max=24,
                        step=1,
                        value=plan_ctx["store"]["months"],
                    ),
                ],
            ),
        ],
    )

    return html.Div(
        className="page-view",
        children=[
            html.Div(
                className="page-header",
                children=[
                    html.Div("Step 3: Plan Sale", className="page-eyebrow"),
                    html.H1("Check if your target price is realistic"),
                    html.P(
                        "Set your target, budget, and timeline. We show if the plan is likely, a stretch, or unrealistic."
                    ),
                ],
            ),
            html.Div(
                className="metric-grid metric-grid--four",
                children=[
                    _metric_card("Likelihood", plan_ctx["status"], "Chance of reaching your target"),
                    _metric_card("Target sale price", plan_ctx["target_value"], "Your requested exit price"),
                    _metric_card("Expected with your plan", plan_ctx["achievable_value"], "Given your budget and timeline"),
                    _metric_card("Gap to target", plan_ctx["gap_value"], plan_ctx["gap_note"]),
                ],
            ),
            html.Div(
                className="content-grid",
                children=[
                    _panel(
                        "Set your plan assumptions",
                        "Adjust these three inputs first. The target realism and action recommendations update automatically.",
                        planner_inputs,
                        class_name="panel-card span-5",
                    ),
                    _panel(
                        "Are you on track?",
                        "Compare where you are now, where your current plan gets you, and the target you want.",
                        dcc.Graph(figure=plan_ctx["comparison_fig"], config={"displayModeBar": False, "responsive": True}),
                        class_name="panel-card span-7",
                    ),
                    _panel(
                        "Recommended upgrades for your constraints",
                        "These are prioritized to maximize uplift within the current budget and timeline.",
                        dcc.Graph(figure=plan_ctx["recommended_fig"], config={"displayModeBar": False, "responsive": True}),
                        class_name="panel-card span-7",
                    ),
                    _panel(
                        "Simple plan summary",
                        "Use this plain-language summary to decide whether to lower target, increase budget, or extend timeline.",
                        plan_ctx["summary"],
                        class_name="panel-card span-5",
                    ),
                    _panel(
                        "Advanced recommendation details",
                        "Open for full action-level table with costs, net gain, and timelines.",
                        html.Details(
                            className="advanced-details",
                            children=[
                                html.Summary("Show recommended action table"),
                                dash_table.DataTable(
                                    id="helper-table",
                                    columns=[
                                        {"name": "Recommended Action", "id": "action"},
                                        {"name": "Estimated Uplift", "id": "uplift_display"},
                                        {"name": "Cost", "id": "cost_display"},
                                        {"name": "Net Gain", "id": "net_display"},
                                        {"name": "Timeline (months)", "id": "months"},
                                    ],
                                    data=plan_ctx["table_data"],
                                    page_size=8,
                                    **TABLE_STYLE,
                                ),
                            ],
                        ),
                        class_name="panel-card span-12",
                    ),
                ],
            ),
        ],
    )


TABLE_STYLE = {
    "style_table": {"overflowX": "auto"},
    "style_cell": {
        "textAlign": "left",
        "padding": "12px 14px",
        "fontFamily": "Inter, Segoe UI, sans-serif",
        "fontSize": "14px",
        "border": "none",
        "backgroundColor": "transparent",
        "whiteSpace": "normal",
        "height": "auto",
    },
    "style_header": {
        "backgroundColor": "#edf3fa",
        "fontWeight": 800,
        "border": "none",
        "color": "#18344f",
    },
    "style_data": {
        "border": "none",
        "backgroundColor": "transparent",
        "color": "#274766",
    },
    "style_data_conditional": [{"if": {"row_index": "odd"}, "backgroundColor": "#f7fafe"}],
}


app = Dash(
    __name__,
    suppress_callback_exceptions=True,
    external_stylesheets=[
        "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Sora:wght@500;600;700&display=swap"
    ],
    title="Vancouver Home Value Uplift Planner",
)
server = app.server


def _drawer_layout():
    return html.Div(
        id="profile-drawer-shell",
        className="profile-drawer-shell",
        children=[
            html.Div(id="profile-drawer-backdrop", className="profile-drawer-backdrop"),
            html.Div(
                className="profile-drawer-panel",
                children=[
                    html.Div(
                        className="drawer-header",
                        children=[
                            html.Div(
                                children=[
                                    html.Div("Edit home profile", className="drawer-eyebrow"),
                                    html.H2("Update the pricing assumptions"),
                                    html.P(
                                        "This is the shared profile used across Overview, Value Drivers, and Sell Plan."
                                    ),
                                ]
                            ),
                            html.Button("Close", id="close-profile-editor", className="drawer-close-btn"),
                        ],
                    ),
                    html.Div(
                        className="drawer-section-grid",
                        children=[
                            html.Div(
                                className="drawer-section",
                                children=[
                                    html.Div("Basics", className="drawer-section-title"),
                                    html.Div(
                                        className="drawer-form-grid",
                                        children=[
                                            html.Div(
                                                className="drawer-field",
                                                children=[
                                                    html.Label("Neighbourhood"),
                                                    dcc.Dropdown(
                                                        id="editor-neighbourhood",
                                                        options=[{"label": value, "value": value} for value in NEIGHBOURHOODS],
                                                        clearable=False,
                                                    ),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field",
                                                children=[
                                                    html.Label("Property type"),
                                                    dcc.Dropdown(
                                                        id="editor-property-type",
                                                        options=[{"label": value, "value": value} for value in PROPERTY_TYPES],
                                                        clearable=False,
                                                    ),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field",
                                                children=[
                                                    html.Label("Living area"),
                                                    dcc.Input(id="editor-living-area", type="number", min=350, step=10),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field",
                                                children=[
                                                    html.Label("Lot size"),
                                                    dcc.Input(id="editor-lot-size", type="number", min=0, step=20),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field",
                                                children=[
                                                    html.Label("Bedrooms"),
                                                    dcc.Input(id="editor-bedrooms", type="number", min=1, max=10, step=1),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field",
                                                children=[
                                                    html.Label("Bathrooms"),
                                                    dcc.Input(id="editor-bathrooms", type="number", min=1, max=8, step=0.5),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field",
                                                children=[
                                                    html.Label("Home age"),
                                                    dcc.Input(id="editor-age", type="number", min=0, max=140, step=1),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field",
                                                children=[
                                                    html.Label("Known current value"),
                                                    dcc.Input(id="editor-known-current-value", type="number", min=0, step=1000, placeholder="Optional appraisal value"),
                                                ],
                                            ),
                                        ],
                                    ),
                                ],
                            ),
                            html.Div(
                                className="drawer-section",
                                children=[
                                    html.Div("Advanced valuation", className="drawer-section-title"),
                                    html.Div(
                                        className="drawer-slider-stack",
                                        children=[
                                            html.Div(
                                                className="drawer-field drawer-field--full",
                                                children=[
                                                    html.Label("Condition score"),
                                                    dcc.Slider(id="editor-condition", min=1, max=5, step=0.1),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field drawer-field--full",
                                                children=[
                                                    html.Label("Walk score"),
                                                    dcc.Slider(id="editor-walk", min=20, max=100, step=1),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field drawer-field--full",
                                                children=[
                                                    html.Label("Transit score"),
                                                    dcc.Slider(id="editor-transit", min=20, max=100, step=1),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field drawer-field--full",
                                                children=[
                                                    html.Label("School score"),
                                                    dcc.Slider(id="editor-school", min=20, max=100, step=1),
                                                ],
                                            ),
                                            html.Div(
                                                className="drawer-field drawer-field--full",
                                                children=[
                                                    html.Label("Mortgage rate assumption"),
                                                    dcc.Slider(id="editor-rate", min=1.5, max=8, step=0.1),
                                                ],
                                            ),
                                        ],
                                    ),
                                ],
                            ),
                            html.Div(
                                className="drawer-section",
                                children=[
                                    html.Div("Positive attributes", className="drawer-section-title"),
                                    html.Div(
                                        className="drawer-field drawer-field--full",
                                        children=[
                                            dcc.Checklist(
                                                id="editor-current-features",
                                                options=[
                                                    {"label": "Kitchen renovated", "value": "renovated_kitchen"},
                                                    {"label": "Bathrooms renovated", "value": "renovated_bathrooms"},
                                                    {"label": "Legal suite", "value": "has_legal_suite"},
                                                    {"label": "Energy efficient", "value": "energy_efficient"},
                                                    {"label": "Strong curb appeal", "value": "curb_appeal_boost"},
                                                    {"label": "Recent permits closed", "value": "permit_closed_recently"},
                                                ],
                                                className="checklist checklist--drawer",
                                            )
                                        ],
                                    ),
                                ],
                            ),
                            html.Div(
                                className="drawer-section",
                                children=[
                                    html.Div("Current drags", className="drawer-section-title"),
                                    html.Div(
                                        className="drawer-field drawer-field--full",
                                        children=[
                                            dcc.Checklist(
                                                id="editor-risk-features",
                                                options=[
                                                    {"label": "Deferred maintenance", "value": "deferred_maintenance"},
                                                    {"label": "Roof issue", "value": "roof_issue"},
                                                ],
                                                className="checklist checklist--drawer",
                                            )
                                        ],
                                    ),
                                ],
                            ),
                        ],
                    ),
                    html.Div(
                        className="drawer-actions",
                        children=[
                            html.Button("Cancel", id="cancel-profile-editor", className="drawer-secondary-btn"),
                            html.Button("Save profile", id="save-profile-editor", className="drawer-primary-btn"),
                        ],
                    ),
                ],
            ),
        ],
    )


app.layout = html.Div(
    className="app-shell",
    children=[
        dcc.Location(id="router", refresh=False),
        dcc.Store(id="profile-store", data=_default_profile_store()),
        dcc.Store(id="scenario-store", data=_default_scenario_store()),
        dcc.Store(id="planner-store", data=_default_planner_store()),
        html.Div(
            className="site-shell",
            children=[
                html.Header(
                    className="site-header",
                    children=[
                        html.Div(
                            className="site-header-inner",
                            children=[
                                html.Div(
                                    className="sidebar-brand",
                                    children=[
                                        html.Div("VV", className="brand-mark"),
                                        html.Div(
                                            children=[
                                                html.Div("Vancouver Value Lab", className="brand-title"),
                                                html.Div("Seller pricing and uplift planner", className="brand-subtitle"),
                                            ]
                                        ),
                                    ],
                                ),
                                html.Nav(
                                    className="site-nav",
                                    children=[
                                        dcc.Link("Overview", href="/overview", id="nav-overview", className="site-nav-link"),
                                        dcc.Link("Value Drivers", href="/value-drivers", id="nav-value-drivers", className="site-nav-link"),
                                        dcc.Link("Sell Plan", href="/sell-plan", id="nav-sell-plan", className="site-nav-link"),
                                    ],
                                ),
                                html.Button("Edit Home Profile", id="open-profile-editor", className="site-header-btn"),
                            ],
                        ),
                    ],
                ),
                html.Div(
                    className="site-summary-strip",
                    children=[
                        html.Div(
                            className="site-summary-inner",
                            children=[
                                html.Div(id="sidebar-profile-summary"),
                                html.Div(
                                    className="site-summary-copy",
                                    children=[
                                        html.Div("Vancouver-first pricing website", className="site-summary-eyebrow"),
                                        html.H2("A simple 3-step flow for homeowners preparing to sell."),
                                        html.P(
                                            "Start with your baseline estimate, test improvement scenarios, then pressure-test your target price with a practical sale plan."
                                        ),
                                        html.Div(
                                            className="journey-steps",
                                            children=[
                                                html.Div(
                                                    id="journey-overview",
                                                    className="journey-step",
                                                    children=[
                                                        html.Div("1", className="journey-step-index"),
                                                        html.Div(
                                                            children=[
                                                                html.Div("Estimate", className="journey-step-title"),
                                                                html.Div("Know your starting value", className="journey-step-note"),
                                                            ]
                                                        ),
                                                    ],
                                                ),
                                                html.Div(
                                                    id="journey-drivers",
                                                    className="journey-step",
                                                    children=[
                                                        html.Div("2", className="journey-step-index"),
                                                        html.Div(
                                                            children=[
                                                                html.Div("Improve", className="journey-step-title"),
                                                                html.Div("Test upgrades and drags", className="journey-step-note"),
                                                            ]
                                                        ),
                                                    ],
                                                ),
                                                html.Div(
                                                    id="journey-plan",
                                                    className="journey-step",
                                                    children=[
                                                        html.Div("3", className="journey-step-index"),
                                                        html.Div(
                                                            children=[
                                                                html.Div("Plan Sale", className="journey-step-title"),
                                                                html.Div("Check if target is realistic", className="journey-step-note"),
                                                            ]
                                                        ),
                                                    ],
                                                ),
                                            ],
                                        ),
                                    ],
                                ),
                            ],
                        ),
                    ],
                ),
                html.Main(id="page-content", className="content-shell"),
                html.Footer(
                    className="site-footer",
                    children="Synthetic Vancouver training set for product prototyping only.",
                ),
            ],
        ),
        _drawer_layout(),
    ],
)


@app.callback(
    Output("nav-overview", "className"),
    Output("nav-value-drivers", "className"),
    Output("nav-sell-plan", "className"),
    Output("journey-overview", "className"),
    Output("journey-drivers", "className"),
    Output("journey-plan", "className"),
    Input("router", "pathname"),
)
def update_nav_state(pathname):
    active_path = _normalize_path(pathname)
    base = "site-nav-link"
    step_base = "journey-step"
    return (
        f"{base} is-active" if active_path == "/overview" else base,
        f"{base} is-active" if active_path == "/value-drivers" else base,
        f"{base} is-active" if active_path == "/sell-plan" else base,
        f"{step_base} is-active" if active_path == "/overview" else step_base,
        f"{step_base} is-active" if active_path == "/value-drivers" else step_base,
        f"{step_base} is-active" if active_path == "/sell-plan" else step_base,
    )


@app.callback(Output("sidebar-profile-summary", "children"), Input("profile-store", "data"))
def render_sidebar_summary(profile_data):
    return _sidebar_summary(profile_data)


@app.callback(
    Output("page-content", "children"),
    Input("router", "pathname"),
    Input("profile-store", "data"),
    Input("scenario-store", "data"),
    Input("planner-store", "data"),
)
def render_page(pathname, profile_data, scenario_data, planner_data):
    active_path = _normalize_path(pathname)
    if active_path == "/value-drivers":
        return _value_drivers_page(profile_data, scenario_data)
    if active_path == "/sell-plan":
        return _sell_plan_page(profile_data, planner_data)
    return _overview_page(profile_data)


@app.callback(
    Output("profile-drawer-shell", "className"),
    Input("open-profile-editor", "n_clicks"),
    Input("close-profile-editor", "n_clicks"),
    Input("cancel-profile-editor", "n_clicks"),
    Input("save-profile-editor", "n_clicks"),
    State("profile-drawer-shell", "className"),
    prevent_initial_call=True,
)
def toggle_profile_drawer(open_clicks, close_clicks, cancel_clicks, save_clicks, current_class):
    _ = open_clicks, close_clicks, cancel_clicks, save_clicks
    base_class = "profile-drawer-shell"
    trigger = ctx.triggered_id
    if trigger == "open-profile-editor":
        return f"{base_class} is-open"
    if trigger in {"close-profile-editor", "cancel-profile-editor", "save-profile-editor"}:
        return base_class
    return current_class or base_class


@app.callback(
    Output("editor-neighbourhood", "value"),
    Output("editor-property-type", "value"),
    Output("editor-living-area", "value"),
    Output("editor-lot-size", "value"),
    Output("editor-bedrooms", "value"),
    Output("editor-bathrooms", "value"),
    Output("editor-age", "value"),
    Output("editor-known-current-value", "value"),
    Output("editor-condition", "value"),
    Output("editor-walk", "value"),
    Output("editor-transit", "value"),
    Output("editor-school", "value"),
    Output("editor-rate", "value"),
    Output("editor-current-features", "value"),
    Output("editor-risk-features", "value"),
    Input("profile-store", "data"),
)
def populate_profile_editor(profile_data):
    store = _coerce_profile_store(profile_data)
    return (
        store["neighbourhood"],
        store["property_type"],
        store["living_area_sqft"],
        store["lot_size_sqft"],
        store["bedrooms"],
        store["bathrooms"],
        store["age_years"],
        store["known_current_value"],
        store["condition_score"],
        store["walk_score"],
        store["transit_score"],
        store["school_score"],
        store["interest_rate"],
        store["current_features"],
        store["risk_features"],
    )


@app.callback(
    Output("profile-store", "data"),
    Input("save-profile-editor", "n_clicks"),
    State("editor-neighbourhood", "value"),
    State("editor-property-type", "value"),
    State("editor-living-area", "value"),
    State("editor-lot-size", "value"),
    State("editor-bedrooms", "value"),
    State("editor-bathrooms", "value"),
    State("editor-age", "value"),
    State("editor-known-current-value", "value"),
    State("editor-condition", "value"),
    State("editor-walk", "value"),
    State("editor-transit", "value"),
    State("editor-school", "value"),
    State("editor-rate", "value"),
    State("editor-current-features", "value"),
    State("editor-risk-features", "value"),
    prevent_initial_call=True,
)
def save_profile(
    n_clicks,
    neighbourhood,
    property_type,
    living_area_sqft,
    lot_size_sqft,
    bedrooms,
    bathrooms,
    age_years,
    known_current_value,
    condition_score,
    walk_score,
    transit_score,
    school_score,
    interest_rate,
    current_features,
    risk_features,
):
    _ = n_clicks
    return _coerce_profile_store(
        {
            "neighbourhood": neighbourhood,
            "property_type": property_type,
            "living_area_sqft": living_area_sqft,
            "lot_size_sqft": lot_size_sqft,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "age_years": age_years,
            "known_current_value": known_current_value,
            "condition_score": condition_score,
            "walk_score": walk_score,
            "transit_score": transit_score,
            "school_score": school_score,
            "interest_rate": interest_rate,
            "current_features": current_features,
            "risk_features": risk_features,
        }
    )


@app.callback(
    Output("scenario-store", "data"),
    Input("scenario-upgrades", "value"),
    Input("scenario-drags", "value"),
    prevent_initial_call=True,
)
def update_scenario_store(upgrades, drags):
    return _coerce_scenario_store({"upgrades": upgrades, "drags": drags})


@app.callback(
    Output("planner-store", "data"),
    Input("planner-target-price", "value"),
    Input("planner-budget", "value"),
    Input("planner-months", "value"),
    prevent_initial_call=True,
)
def update_planner_store(target_price, budget, months):
    return _coerce_planner_store({"target_price": target_price, "budget": budget, "months": months})


if __name__ == "__main__":
    app.run(debug=False, host="127.0.0.1", port=8050)
