# SHAP-based per-prediction driver explanations shared by the valuation model services.
from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline

try:
    import shap

    SHAP_AVAILABLE = True
    SHAP_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - depends on local shap/numba install
    shap = None
    SHAP_AVAILABLE = False
    SHAP_IMPORT_ERROR = str(exc)

# Step names match _build_candidate_pipelines in base_model/core.py.
PREPROCESSOR_STEP = "prep"
REGRESSOR_STEP = "model"

MIN_DRIVER_DOLLARS = 5_000
MAX_DRIVERS = 6

# Friendly labels mirror NUMERIC_FEATURES / CATEGORICAL_FEATURES in base_model/core.py,
# phrased to read like the heuristic _driver_candidates labels.
NUMERIC_FEATURE_LABELS = {
    "livingAreaSqft": "Living area",
    "bedrooms": "Bedrooms",
    "bathrooms": "Bathrooms",
    "latitude": "Location (north-south)",
    "longitude": "Location (east-west)",
    "lat_x_lon": "Location (lat-lon interaction)",
    "lat_sq": "Location (north-south curve)",
    "lon_sq": "Location (east-west curve)",
    "ageYears": "Property age",
}
CATEGORICAL_FEATURE_LABEL_TEMPLATES = {
    "postalFsa": "Postal area {category}",
    # Cluster identifiers are implementation details; expose the human meaning, not "cluster-00".
    "submarketCluster": "Neighbourhood pattern",
    "propertyType": "Property type: {category}",
}


def _clean_raw_name(name: str) -> str:
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name.replace("__", " ").replace("_", " "))
    cleaned = " ".join(spaced.split()).lower()
    if not cleaned:
        return name
    return cleaned[:1].upper() + cleaned[1:]


def _split_transformed_name(name: str) -> tuple[str, str, str | None]:
    if name.startswith("num__"):
        return "num", name[len("num__"):], None

    if name.startswith("cat__"):
        remainder = name[len("cat__"):]
        # Known sources first because one-hot category values may themselves contain underscores.
        for source in CATEGORICAL_FEATURE_LABEL_TEMPLATES:
            if remainder.startswith(source + "_"):
                return "cat", source, remainder[len(source) + 1:]
        source, _, category = remainder.partition("_")
        return "cat", source, category or None

    return "other", name, None


def _label_for(kind: str, source: str, category: str | None) -> str:
    if kind == "num":
        return NUMERIC_FEATURE_LABELS.get(source, _clean_raw_name(source))

    if kind == "cat":
        template = CATEGORICAL_FEATURE_LABEL_TEMPLATES.get(source)
        if template is None:
            base = _clean_raw_name(source)
            return f"{base}: {category}" if category else base
        if category is None:
            # Unseen category at inference (handle_unknown="ignore" leaves every one-hot at zero).
            return template.format(category="").rstrip(": ")
        return template.format(category=category)

    return _clean_raw_name(source)


def shap_drivers(
    pipeline: Pipeline,
    feature_frame: pd.DataFrame,
    base_value: float,
) -> tuple[list[dict[str, Any]] | None, str]:
    """Explain a single prediction with SHAP, returning dollar drivers or degrading.

    Expects the fitted pipeline shape from base_model/core.py: a "prep" ColumnTransformer
    step followed by a tree-ensemble "model" step trained on LOG price. One-hot columns of
    the same source feature are collapsed into a single driver by summing their SHAP values,
    labeled with the row's active category.

    Dollar convention: each aggregated log-space contribution phi_i is converted as
    dollar_i = base_value * (exp(phi_i) - 1), i.e. the multiplicative effect of that
    feature's log contribution applied against the final estimate that already includes
    phi_i. The alternative convention base_value * (1 - exp(-phi_i)) measures against the
    estimate with phi_i removed; both are approximations because log-space contributions
    only sum exactly before exponentiation, so per-feature dollars need not sum to the
    estimate.

    Returns (drivers, "shap") on success — drivers is the list of
    {"label", "value", "source": "shap"} dicts with abs(value) >= 5,000, sorted by
    magnitude, top 6, and may be empty — or (None, "heuristic") whenever SHAP cannot be
    used (shap not importable, non-tree regressor, any SHAP failure). Never raises.
    """
    if not SHAP_AVAILABLE:
        return None, "heuristic"

    try:
        preprocessor = pipeline.named_steps[PREPROCESSOR_STEP]
        regressor = pipeline.named_steps[REGRESSOR_STEP]

        transformed = preprocessor.transform(feature_frame)
        if hasattr(transformed, "toarray"):
            transformed = transformed.toarray()
        transformed = np.asarray(transformed, dtype=float)
        feature_names = [str(name) for name in preprocessor.get_feature_names_out()]

        explainer = shap.TreeExplainer(regressor)
        try:
            shap_values = explainer.shap_values(transformed, check_additivity=False)
        except TypeError:  # pragma: no cover - older shap without the keyword
            shap_values = explainer.shap_values(transformed)

        row_values = np.asarray(shap_values, dtype=float)[0].ravel()
        if row_values.shape[0] != len(feature_names):
            return None, "heuristic"
        transformed_row = transformed[0]

        contributions: dict[tuple[str, str], dict[str, Any]] = {}
        for index, name in enumerate(feature_names):
            kind, source, category = _split_transformed_name(name)
            entry = contributions.setdefault((kind, source), {"phi": 0.0, "category": None})
            entry["phi"] += float(row_values[index])
            if kind == "cat" and float(transformed_row[index]) >= 0.5:
                entry["category"] = category

        candidates = []
        for (kind, source), entry in contributions.items():
            candidates.append(
                {
                    "label": _label_for(kind, source, entry["category"]),
                    "value": int(round(float(base_value) * (math.exp(entry["phi"]) - 1.0))),
                },
            )

        filtered = [candidate for candidate in candidates if abs(candidate["value"]) >= MIN_DRIVER_DOLLARS]
        top_drivers = sorted(filtered, key=lambda item: abs(item["value"]), reverse=True)[:MAX_DRIVERS]
        return [{"label": item["label"], "value": item["value"], "source": "shap"} for item in top_drivers], "shap"
    except Exception:
        return None, "heuristic"
