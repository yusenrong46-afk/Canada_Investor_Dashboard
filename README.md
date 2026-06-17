# Canada Investor Dashboard

A full-stack, multi-market real estate analytics dashboard that estimates property value in Vancouver (listing-price model) and Halifax/Maritimes (real sale-price model trained on PVSC open data), evaluates renovation upside, and generates investor-facing action plans through an Estimate -> Improve -> Plan workflow — with split conformal prediction intervals, SHAP explanations, spatial cross-validation, a warehouse-backed market evidence panel, and a Statistics Canada market trend forecast.

GitHub: https://github.com/yusenrong46-afk/Canada_Investor_Dashboard

## Why I Built This

Real estate investors often compare properties using messy, fragmented data: listings, public records, permits, property features, location signals, renovation assumptions, and model outputs. This project turns those inputs into a clean decision-support workflow.

I built it as a portfolio project for Data Analyst, BI Analyst, Analytics Engineer, and Junior Data Scientist roles in Canada.

## What It Does

1. Estimates current property value from structured property features in two markets: Vancouver (V5/V6 postal codes, listing-price target) and Halifax/Maritimes (B-prefix postal codes, time-adjusted real sale-price target from PVSC parcel sales).
2. Shows calibrated uncertainty: 80%-target split conformal intervals with *measured* empirical coverage, plus SHAP per-prediction driver attributions in live mode.
3. Backs every estimate with a warehouse evidence panel: real FSA-level training rows, medians, and $/sqft exported from the DuckDB analytics warehouse.
4. Maps both markets: an interactive H3 choropleth (802 hex cells, $/sqft medians, observation counts) built from the warehouse mart.
5. Shows where the market is heading: Statistics Canada NHPI history with a 12-month ETS forecast band and backtested MAPE per market.
6. Simulates renovation value uplift from observed repeat-sale data: Seattle/King County proxy for Vancouver, and a *local* HRM layer for Halifax (PVSC repeat-sale pairs joined to geolocated building permits — 12.1% median excess uplift for Renovation from 131 treated pairs; Addition reported as insufficient-data at 37 pairs, contributing zero).
7. Stress-tests every deal with Monte Carlo robustness: 5,000 seeded draws through the conformal band, yielding P(positive upside), P(target achievable), and P10/P50/P90 upside.
8. Compares local vs pooled vs hybrid valuation models across markets in a model experiment lab (warehouse `fact_model_experiments` + leaderboard on the Model page, with honestly derived conclusions).
9. Generates an investment action plan based on budget, target price, timeline, and risk flags.
10. Provides transparent data-quality checks instead of hiding missing or weak inputs.

## Why It Matters For Data Analyst Roles

This project demonstrates:

- data cleaning
- feature engineering
- model evaluation
- dashboard design
- business insight generation
- data-quality reporting
- API-backed analytics workflows
- stakeholder-facing communication

## Project Architecture

```text
React / TypeScript frontend (all routes lazy-loaded)
  /estimate          Estimate current value (conformal band, SHAP drivers, evidence panel, trend chart)
  /improve           Test renovation uplift
  /plan              Build an investor action plan
  /map               Interactive H3 market map (Leaflet choropleth from the warehouse)
  /workspace         Save and compare user-created scenarios
  /insights          Market & Investment Insights
  /deal-analyzer     One-page deal screening with Monte Carlo robustness
  /model-data-story  Model story + multi-market model lab leaderboard

Express API
  GET  /health
  POST /api/estimate       routes by postal prefix: V5/V6 -> Vancouver, B -> Halifax
  POST /api/simulate
  POST /api/plan
  POST /api/deal/analyze
  GET  /api/insights
  GET  /api/markets        per-mode market availability
  GET  /api/evidence       warehouse-backed FSA evidence (all modes, committed export)
  GET  /api/trend          NHPI history + 12-month ETS forecast per market
  GET  /api/map            H3 choropleth cells from the warehouse mart
  GET  /api/experiments    local vs pooled vs hybrid model leaderboard

Python model service
  /estimate  market dispatch: Vancouver listing-price model (v5) or Halifax sale-price model (v1)
  /uplift    market dispatch: Seattle observed proxy (Vancouver) or HRM repeat-sale + permit medians (Halifax)
  /trend     market trend export
  /health    per-market bundle status

Analytics warehouse
  DuckDB training mart shared by both markets (21,483 model-ready observations)
  Per-market staging + insert scripts, H3 cells, market summaries, per-market quality checks
  fact_market_trend (StatCan NHPI history + forecasts), fact_model_experiments (model lab runs)
  One-command rebuild: scripts/build_all.py
```

Main folders:

```text
artifacts/shared/              shared TypeScript schemas and types
artifacts/home-value-planner/  React dashboard
artifacts/api-server/          Express API
artifacts/model-service/       Python Flask model service
analytics/warehouse/           DuckDB SQL schema and model-ready marts
data/processed/                demo-safe processed training summaries
demo/                          public sample outputs for demo mode
docs/                          portfolio documentation
reports/                       generated model and data-quality reports
tests/                         focused Python tests
```

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind, Recharts, Leaflet (lazy-loaded route chunks)
- API: Express.js, Zod validation
- Model service: Python, Flask, pandas, scikit-learn, XGBoost when available, SHAP, hand-rolled split conformal prediction
- Forecasting: statsmodels ETS on Statistics Canada NHPI (Open Government Licence)
- Geospatial: H3 hex cells, KMeans submarkets, GroupKFold spatial cross-validation by FSA
- Analytics warehouse: DuckDB SQL marts for multi-market model training, market summaries, and trend data
- Reports/tests: pytest, Vitest, Markdown report scripts
- Data workflow: Vancouver listing data, PVSC/datazONE parcel sales + dwelling characteristics + assessments, HRM civic addresses and building permits, Seattle/King County repeat-sale uplift data
- Scenario workspace: browser localStorage for user-saved comparisons

## How To Run

Install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
corepack enable
pnpm install
```

Run live mode in separate terminals:

```bash
pnpm dev:model
```

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Default URLs:

- frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:4000`
- model service: `http://127.0.0.1:5001`

## Demo Mode

Demo mode lets the project run without private/local raw data or model artifacts.

Use these environment variables:

```bash
DEMO_MODE=true
VITE_DEMO_MODE=true
```

When demo mode is enabled:

- the Express API returns stable sample JSON from `demo/`
- the frontend shows a public demo banner
- the dashboard can be reviewed without starting the Python model service
- the outputs are clearly labeled as demo-safe sample outputs

Demo values are not live predictions and should not be presented as fresh market results.

## Public Deployment

The public portfolio version is designed to deploy as an interactive screening product:

- Vercel serves the React/Vite frontend from `vercel.json`.
- Vercel runs the Express API through the small serverless adapter in `api/[...path].js`.
- The Python model service is not required for the public site.
- `PUBLIC_MODE=true` makes the hosted API calculate estimates, renovation upside, plans, and deal verdicts from user inputs.
- `DEMO_MODE=true` still exists for fixed sample-output testing.

This keeps the recruiter version usable like a real product while keeping private/local data out of the hosted app.

## Scenario Workspace

The app now works as an interactive scenario workspace.

Users can:

- run a Plan scenario
- run a Deal Analyzer scenario
- save the result
- compare saved scenarios side by side
- use a saved scenario to reload the property and improvements into the active workflow
- open Insights and see metrics calculated from saved scenarios instead of only demo sample rows

Saved scenarios stay in the browser through localStorage. This keeps the portfolio project simple and explainable without adding authentication or a database too early.

## Demo Walkthrough

Use `docs/demo-script.md` for the interview walkthrough. The live app is the primary demo artifact, so placeholder screenshot paths are intentionally not kept in the repo.

## Reports

Generate the model report:

```bash
.venv/bin/python scripts/generate_model_report.py
```

Generate the data-quality report:

```bash
.venv/bin/python scripts/generate_data_quality_report.py
```

Build the local analytics warehouse (both markets):

```bash
.venv/bin/python scripts/build_property_warehouse.py
```

Download and rebuild the Halifax open data + training extract (PVSC datazONE + HRM open data):

```bash
.venv/bin/python scripts/setup_halifax_data.py --download-pvsc --download-hrm
.venv/bin/python scripts/setup_halifax_data.py --build-training
```

Rebuild the market trend forecast (StatCan NHPI) and the committed exports:

```bash
.venv/bin/python scripts/build_market_trend.py --download
.venv/bin/python scripts/export_market_evidence.py
.venv/bin/python scripts/export_market_map.py
.venv/bin/python scripts/build_halifax_uplift.py
.venv/bin/python scripts/run_model_experiments.py
```

Or rebuild everything that has inputs available, in dependency order, with one command:

```bash
.venv/bin/python scripts/build_all.py
```

The warehouse is written to `data/warehouse/property_analytics.duckdb`, a build summary to `reports/analytics_warehouse_report.md`, and the committed exports to `data/exports/` (these power the evidence panel and trend chart in every mode, including the public Vercel deployment).

The scripts do not invent missing metrics. If a model artifact or data file is missing, the report says exactly what is missing.

## MLflow Tracking & Model Registry

Experiment and production training are tracked in a local, SQLite-backed MLflow store with a model
registry that drives production model selection:

- The experiment lab logs every `local`/`pooled`/`hybrid` run, so model history is kept (the DuckDB
  leaderboard is overwritten each run; MLflow is the history of record).
- Production bundles (`vancouver-base-price`, `halifax-base-price`) are registered, and a documented
  promotion policy (lowest **spatial CV MAE**, with a holdout-MAPE guardrail) transitions the best
  version to `Production`.
- In live mode, `MODEL_REGISTRY_ENABLED=1` makes the model service serve the registry's Production
  model (with a safe fallback to the committed bundle); the served version/architecture is surfaced
  in `/health` and in the `modelVersion` field.

```bash
.venv/bin/python scripts/train_production_bundles.py   # train + log + register
.venv/bin/python scripts/promote_models.py             # promote the spatial-CV winner
.venv/bin/python scripts/export_registry_snapshot.py   # refresh data/exports/model_registry.json
pnpm mlflow:ui                                          # browse runs + registry at :5000
```

See [docs/mlflow.md](docs/mlflow.md) for the store layout, naming, policy rationale, and the
MLflow 2-vs-3 pin.

## Limitations

- The Vancouver model predicts listing price, not final sale price. The Halifax model predicts a time-adjusted real sale price, but the adjustment index is HRM-wide.
- The app is useful for screening and explanation, not appraisal or lending decisions.
- Conformal intervals give marginal (dataset-level) coverage, not a per-property probability; coverage is measured and shown, not assumed.
- Halifax has no Condo coverage — PVSC open data does not include condo unit characteristics, and the app says so instead of guessing.
- Vancouver renovation uplift uses transferred observed assumptions from Seattle/King County repeat-sale data. Halifax uplift is local and observed (HRM permits joined to PVSC repeat sales) but rests on 131 treated Renovation pairs — the Addition category (37 pairs) is reported as insufficient and contributes zero.
- Deal robustness is a triangular Monte Carlo over the calibrated bands — a transparency tool, not a market simulation.
- The market trend layer uses the StatCan New Housing Price Index as a direction proxy (new housing only); CREA HPI cannot be displayed publicly under its licence.
- Demo mode uses precomputed sample outputs; public mode computes from committed evidence medians and is clearly labelled as a screening band, not the conformal live model.
- Transaction costs, taxes, financing, strata rules, exact condition, and seller motivation still need manual review.

## Future Improvements

- Promote the experiment lab's findings into production model selection (e.g., pooled spatial advantages for unseen FSAs) and add MLflow tracking on top of `fact_model_experiments`.
- Grow the Halifax local uplift sample as more permit history accumulates (Addition is 37 pairs today) and segment Renovation by permit value.
- OSM amenity/transit proximity features keyed on the mart's H3 cells.
- Better Vancouver sale-price labels.
- Saved projects and authentication.
- Full live-mode deployment after the Python model service is ready for public hosting.

## Interview Summary

My 30-second explanation:

> I built a full-stack, two-market real estate analytics platform. Vancouver runs a listing-price model; Halifax runs on real PVSC sale prices that I onboarded end to end from open data — including a civic-address postal bridge and a time-adjustment index I derived from the sales themselves. Estimates ship with split conformal intervals whose coverage is measured, SHAP driver attributions, a DuckDB-warehouse evidence panel, and a backtested StatCan trend forecast. The point is not just a model — it is a decision workflow where every number is traceable to a real source and every limitation is stated.
