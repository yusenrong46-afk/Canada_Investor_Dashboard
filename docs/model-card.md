# Model Card

## Models

| Model | Target | Geography | Property types | Bundle |
|---|---|---|---|---|
| Vancouver Listing-Price Model | Listing price | Vancouver (V5/V6 FSAs) | Condo, Detached, Townhouse, Duplex | `vancouver_base_price_bundle_v5.pkl` |
| Halifax Sale-Price Model | Real sale price, time-adjusted | Halifax Regional Municipality (B-prefix FSAs) | Detached, Townhouse, Duplex | `halifax_base_price_bundle_v1.pkl` |

## Intended Use

Both models estimate the current value of a residential property from structured property features, for portfolio demonstration, screening, and decision support. Neither is an appraisal or lender valuation.

The two markets have different valuation bases and I should describe them precisely:

- **Vancouver** is a *listing-price* model. The training data does not prove final sale price.
- **Halifax** is a *sale-price* model: it trains on real PVSC parcel-sales transactions (open data), time-adjusted to the latest observed month with an HRM monthly median sale-price index computed from the same dataset. Sale price is a stronger target than listing price, but the adjustment is HRM-wide and submarket drift differences are not captured.

## Prediction Targets

- Vancouver: listing price; supported types `Condo`, `Detached`, `Townhouse`, `Duplex`.
- Halifax: `sale_price_time_adjusted`; supported types `Detached`, `Townhouse`, `Duplex`. **No Condo support** — PVSC residential dwelling characteristics cover ground-oriented dwellings only, and the API says so explicitly rather than guessing.

## Inputs

User-facing inputs (both markets): postal code, property type, living area square feet, bedrooms, bathrooms, optional year built, optional known current value.

Engineered inputs: postal FSA, latitude/longitude (Vancouver: postal-centroid lookups from listings; Halifax: parcel coordinates at training, civic-address centroid lookups at inference), coordinate interaction terms, KMeans submarket cluster, derived/imputed age. The warehouse mart also carries an H3 (resolution 8) cell per observation for cross-market geographic comparability.

## Training Approach

Separate models per property type; tree-based candidate families (Random Forest, plus XGBoost when available) selected by cross-validation MAE on a log-price target.

### Uncertainty: split conformal prediction

Confidence ranges use **split conformal prediction** on relative residuals (`|actual − predicted| / predicted`) with the finite-sample-corrected quantile at a target coverage of 80%. The holdout is split so empirical coverage is *measured* on rows the calibration never saw, and both numbers are reported in the API response (`uncertainty.targetCoverage`, `uncertainty.empiricalCoverage`) and the model report. The guarantee is marginal coverage over exchangeable data, not a per-property guarantee — I should say "calibrated planning range", not "probability for this house".

### Explanations: SHAP attribution

Per-prediction drivers come from `shap.TreeExplainer` on the selected tree model, with one-hot groups collapsed back to one driver per source feature. Attributions are computed in log-price space and converted to approximate dollar impact (`base × (exp(φ) − 1)`); the convention is documented in `artifacts/model-service/common/explain.py`. When SHAP is unavailable the service falls back to the original heuristic drivers and labels the response `explanationMethod: "heuristic"` — the UI shows which method produced the numbers.

### Geographic honesty: spatial cross-validation

Alongside random cross-validation, training runs a **GroupKFold grouped by postal FSA** and reports the spatial generalization gap (spatial CV MAE vs random CV MAE). A large gap means the model leans on memorized neighborhoods rather than transferable structure; the gap is published per property type in the model report.

## Evaluation

`scripts/generate_model_report.py` writes MAE, RMSE, MAPE, R², holdout sizes, selected family, conformal target-vs-empirical coverage, and the spatial generalization gap per property type. If an artifact is missing or predates these methods, the report says exactly that — it does not invent numbers.

## Market Trend Layer

A separate trend layer (Statistics Canada New Housing Price Index, table 18-10-0205-01, Open Government Licence – Canada) provides per-market history and a 12-month ETS forecast with 80% prediction intervals plus a 12-month holdout backtest MAPE (`scripts/build_market_trend.py`). NHPI covers **new housing only** and is shown as a market-direction proxy, not a resale price level — the disclaimer travels with the data in `dataSource`. CREA HPI can be used as a richer *local-only* index via the existing market-index CSV mechanism, but its licence does not allow public display, so it is never committed or deployed.

## Renovation Uplift Layer

Two paths, dispatched by market:

- **Vancouver**: the observed Seattle/King County repeat-sale + permit proxy, unchanged — calibrated for Vancouver property stock and labelled as transferred evidence.
- **Halifax (local, observed)**: PVSC repeat-sale pairs (consecutive sales of the same assessment account ≥180 days apart, both ≥$100k, ratio guardrails) with both prices time-adjusted by the HRM monthly median index, joined to HRM geolocated permits within 30 m. Treated pairs have a Renovation or Addition permit issued *between* the sales; New Building permits are excluded as redevelopment. Measured result: **Renovation: +12.1% median excess uplift vs controls (131 treated / 16,445 control pairs; p25 −0.4%, p75 +55.9%)**. Addition has only 37 treated pairs and is served as `insufficient-data`, contributing zero with an explicit note. The control sanity check (median time-adjusted control ratio 1.035, within ±10% of 1.0) is asserted at build time. Selected improvement flags map to permit categories and each category is counted once.

This is observational evidence, not a causal estimate: permits proxy for renovations, sale condition is unobserved, and the p25–p75 spread is wide — the API ships that spread, not just the median.

## Model Experiment Lab

`scripts/run_model_experiments.py` trains local, pooled (+market features), and hybrid (pooled + per-market residual) models under one shared protocol on the warehouse mart, scoring each per market and per property-type slice (slices under 30 holdout rows are skipped, not scored) plus spatial GroupKFold by FSA. Measured headline (June 2026): **local wins Vancouver** ($294.6k MAE vs pooled $322.2k — 18k Halifax rows do not beat 2.8k local rows); **Halifax is a three-way tie** (<0.2% spread); **pooling/hybrid win the spatial CV on both markets**, i.e. cross-market structure helps extrapolation into unseen FSAs. The first conclusion in every report states the target-semantics caveat (listing price vs time-adjusted sale price). Results live in `fact_model_experiments` and on the Model page.

## Deal Robustness

Deal verdicts carry a seeded triangular Monte Carlo (5,000 draws) over the calibrated confidence band: P(positive upside), P(target achievable), and P10/P50/P90 upside. It propagates stated uncertainty through the deal arithmetic; it does not model market scenarios.

## Data Quality

- `scripts/generate_data_quality_report.py` — listing-data checks.
- `scripts/build_property_warehouse.py` — per-market warehouse quality gates (source rows, model-ready rows, FSA completeness ≥95%, Halifax time-adjustment guardrail, tracked-only completeness for property tax / assessed value).
- Halifax joins are measured, not assumed: see `docs/halifax-data-recon.md` (93% sale→dwelling join, 99.6% postal bridge match ≤150 m, 11.7% bedrooms imputed and flagged).

## Known Limitations

- Vancouver predicts listing price, not final sale price.
- Halifax sale prices include unobserved condition/renovation effects at sale time; the time adjustment is HRM-wide.
- Halifax postal codes come from the nearest civic-address point (≤150 m guard); boundary misassignment is possible.
- Location features use centroids, not parcel geometry (except Halifax training coordinates, which are parcel-level).
- No condo coverage in Halifax (open-data gap, stated explicitly).
- Renovation uplift remains a Seattle-proxy scenario layer, not a local causal estimate.
- Demo mode uses precomputed sample outputs; public mode uses evidence-derived medians, clearly labelled `error-ratio`/`heuristic`.

## Responsible Use

Use the dashboard to shortlist deals and explain assumptions — not as the sole basis for a purchase decision.
