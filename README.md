# Canada Investor Dashboard

GitHub: https://github.com/yusenrong46-afk/Canada_Investor_Dashboard

I built this project as a full-stack real estate investment dashboard for Vancouver homes. The app now focuses on one clear workflow:

```text
Analyze one deal -> inspect the model and data story
```

The dashboard estimates the as-is value of a Vancouver property, compares it with the asking price, models renovation upside, recommends a budget-aware plan, and explains the risk flags. I also kept a retrieval-first project assistant because I want to practice RAG in a useful way instead of adding AI decoration.

## What The Project Does

- Screens one Vancouver investment deal from property details, asking price, budget, timeline, and planned improvements.
- Uses a Python ML service for the base listing-price estimate.
- Uses a real-data-only Seattle/King County repeat-sale uplift model for renovation percentage guidance.
- Uses an Express API for validation, orchestration, deal labels, and the cited project assistant.
- Uses a React/TypeScript frontend with two main screens: `Deal Analyzer` and `Model & Data Story`.

## Why I Simplified It

The earlier app had too many user-facing layers: Estimate, Improve, Plan, Deal Analyzer, and a Model Story page. That was useful while building, but harder to explain in an interview. I moved the old flow into `legacy/` and kept the strongest product story active.

Current active shape:

```text
React frontend
  /                  Deal Analyzer
  /model-data-story  Model & Data Story + RAG assistant

Express API
  GET  /health
  POST /api/deal/analyze
  POST /api/assistant/query

Python model service
  /estimate  internal base-value model endpoint
  /uplift    internal observed-uplift endpoint
```

## Data Science Summary

### Base Value Model

The base model predicts Vancouver listing price, not final sale price.

Data pipeline:

- starts from a Vancouver subset of `data_bc.csv`
- keeps `Condo`, `Detached`, `Townhouse`, and `Duplex`
- cleans price, square footage, beds, baths, postal code, coordinates, and age/year-built
- removes implausible rows and local price-per-square-foot outliers
- engineers FSA, coordinate polynomial features, and KMeans submarket clusters
- trains one model per property type
- compares XGBoost and Random Forest by cross-validation MAE

Current saved metrics:

- usable Vancouver rows: `3,518`
- overall holdout MAE: about `$331k`
- overall holdout MAPE: about `12.6%`
- overall holdout R2: about `0.82`

Selected model families:

- Condo: XGBoost
- Detached: XGBoost
- Duplex: Random Forest
- Townhouse: XGBoost

### Renovation Uplift Model

This is the most important judgment call in the project. Vancouver listing data does not contain clean before/after renovation resale labels, so I did not fake them.

The uplift layer uses:

- Seattle building permits
- King County sales records
- King County residential building records

It builds observed repeat-sale rows and predicts market-adjusted uplift percentage. The app then applies that percentage to the Vancouver base estimate.

Current saved uplift data:

- permit rows: `36,200`
- sale rows: `1,153,112`
- building rows: `524,289`
- repeat-sale uplift rows: `633`
- holdout MAE: `21.38` percentage points
- holdout R2: `0.162`

That uplift model is useful for scenario screening, but I would not oversell it. It is a bridge until I can get Vancouver transaction data joined to local permits.

## Active Project Structure

```text
artifacts/
  shared/              Shared TypeScript schemas, constants, and response types
  home-value-planner/  React + Vite frontend
  api-server/          Express API and deal orchestration
  model-service/       Flask model service
    base_model/        Vancouver base price model
    uplift_model/      Seattle observed uplift model
  openapi/             Current public API contract

docs/                  Portfolio, model, deployment, and dataset notes
legacy/                Older prototype layers moved out of the active path
tests/                 Python model-service helper tests
```

## Why Shared TypeScript Exists

I moved repeated frontend/API types into `artifacts/shared`.

Simple version:

- `constants.ts` stores shared values like property types and renovation flags.
- `schemas.ts` uses Zod to validate real API input.
- `types.ts` stores TypeScript shapes for responses and objects.

This means I edit the contract once instead of changing it separately in the frontend and API.

## RAG Direction

The assistant is intentionally retrieval-first. It answers from local project docs, model notes, and API docs with citations.

The next manual learning project I want to build on top of this:

```text
RAG Model Coach
```

It should teach me and the user:

- why a deal got a certain label
- what features moved the estimate
- what data trained each model
- why the uplift model is less certain
- what extra data would improve model quality

I want to build that manually step by step, not vibe-code it.

## Datasets I Want To Add Next

The biggest model improvement will come from better joined data, not a fancier algorithm first.

- [BC Assessment property information](https://info.bcassessment.ca/Services-products/buy-and-exchange-data): the best possible upgrade because it can include BC sales, assessment, inventory, permit, and property information.
- [City of Vancouver issued building permits](https://opendata.vancouver.ca/explore/dataset/issued-building-permits/table/): local renovation signals starting in 2017.
- [City of Vancouver property tax report](https://opendata.vancouver.ca/explore/dataset/property-tax-report/information): assessment values, year built, and tax context.
- [Property parcel polygons](https://opendata.vancouver.ca/explore/dataset/property-parcel-polygons/): parcel geometry for better geospatial joins.
- [Zoning districts and labels](https://opendata.vancouver.ca/explore/dataset/zoning-districts-and-labels/custom/): zoning and development context.
- [Statistics Canada Census Profile API](https://www12.statcan.gc.ca/wds-sdw/2021profile-profil2021-eng.cfm): income, dwelling, household, and neighbourhood demand features.
- [CMHC housing data tables](https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-data/data-tables): rental, supply, and market context.
- [CREA MLS HPI data](https://www.crea.ca/housing-market-stats/mls-home-price-index/hpi-tool/): market trend adjustment, subject to usage terms.
- [Bank of Canada statistics](https://www.bankofcanada.ca/rates/): mortgage-rate and affordability context.
- [TransLink GTFS](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data): transit-access features.

## Run Locally

Copy `.env.example` to `.env` and set the local data paths:

```bash
VANCOUVER_LISTINGS_CSV_PATH=/path/to/data_bc.csv
SEATTLE_PERMITS_PATH=/path/to/seattle/building_permits.csv
KING_COUNTY_SALES_PATH=/path/to/king-county/rpsale_extr.csv
KING_COUNTY_BUILDINGS_PATH=/path/to/king-county/resbldg_extr.csv
```

Install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
corepack enable
pnpm install
```

Run the three services in separate terminals:

```bash
source .venv/bin/activate
pnpm dev:model
```

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Default URLs:

- model service: `http://127.0.0.1:5001`
- API: `http://127.0.0.1:4000`
- website: `http://127.0.0.1:5173`

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
PYTHONPYCACHEPREFIX=/private/tmp/codex_pycache .venv/bin/python -m pytest
```

## Interview Summary

My strongest interview story is this:

> I built a full-stack Vancouver real-estate deal analyzer, then simplified it so the product story is clear. The base model estimates as-is listing value from Vancouver data. The renovation layer uses observed Seattle repeat-sale data because the Vancouver listing dataset does not contain real uplift labels. I kept the limitations visible in the UI, docs, and RAG assistant instead of hiding uncertainty behind a single confident number.
