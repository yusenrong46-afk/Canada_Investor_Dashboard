# Canada Investor Dashboard

GitHub: https://github.com/yusenrong46-afk/Canada_Investor_Dashboard

Canada Investor Dashboard is a full-stack data science project for estimating Vancouver home values, testing renovation upside, and turning the result into a simple investor action plan.

The project combines data cleaning, feature engineering, model comparison, backend API design, a Python model service, and a React dashboard. I designed the app around a simple three-step workflow:

1. Estimate the current property price.
2. Explore improvements that may increase value.
3. Build a practical plan around budget, timeline, and target price.

## Resume Summary

Built a full-stack real estate investment dashboard that estimates Vancouver property values, simulates renovation value uplift, and generates investor-facing improvement plans. The app uses a React/TypeScript frontend, an Express API, and a Python ML model service. I trained the base price model on real Vancouver listing data and replaced earlier renovation assumptions with a real-data-only Seattle/King County observed repeat-sale uplift pipeline.

Resume bullets:

- Built a React/TypeScript dashboard with a simplified three-step workflow for property valuation, renovation uplift simulation, and investment planning.
- Developed a Python ML model service using real Vancouver listing data for property price estimation.
- Added a real-data-only Seattle/King County uplift model using building permits, repeat sales, and residential building records to estimate renovation uplift percentages.
- Connected the frontend, Express API, and Python model service through typed request/response contracts and validation.
- Added data validation scripts, model tests, API tests, and clear `data-missing` handling instead of fake or synthetic fallback data.

## Project Question

Can we estimate the current value of a Vancouver home from structured listing features?

Secondary question:

Can we estimate renovation uplift? The Vancouver listing dataset alone cannot do that, so the live uplift layer uses real Seattle/King County permit, sale, and residential-building records to learn observed repeat-sale uplift percentages. Those percentages are then applied to the Vancouver base estimate.

## Current Scope

- City: Vancouver only
- Property types: `Condo`, `Detached`, `Townhouse`, `Duplex`
- Target for the ML model: listing price
- Inputs: postal code, property type, living area, bedrooms, bathrooms, optional year built, optional known current value
- Investor workflow: asking-price comparison, value gap, renovation budget, timeline, risk flags, and gross upside before transaction costs
- Uplift/planning: Seattle-trained observed repeat-sale uplift percentage, applied to the Vancouver estimate

Important limitations:

- The base model predicts listing price, not verified sale price.
- The uplift model transfers Seattle percentage patterns to Vancouver, so local contractor quotes and comparables still matter.
- Outputs are for portfolio/demo and planning exploration, not financial advice.
- Deal verdicts are screening aids, not buy/sell recommendations.

## Data Science Work

### Dataset

The base model uses a Vancouver subset of `data_bc.csv`.

Cleaning steps:

- filter `addressLocality == "Vancouver"`
- keep only the four supported residential property types
- parse price, square footage, beds, baths, postal code, latitude, longitude, and year-built/age signals
- remove rows missing the core pricing fields
- remove extreme outliers by property type using price-per-square-foot and living-area checks

### Feature Engineering

The model uses structured features only:

- numeric: living area, bedrooms, bathrooms, latitude, longitude, home age
- location: postal FSA, full postal-code/FSA centroid fallbacks
- engineered map features: `lat_x_lon`, `lat_sq`, `lon_sq`
- local submarket cluster: KMeans cluster from Vancouver coordinates
- optional current-market index: a real local CSV can adjust the estimate forward from the latest training period; if that CSV is missing, no trend is invented

I intentionally did not use listing descriptions or high-cardinality leakage-prone identifiers.

### Modeling

The base estimator trains separate models by property type.

For each property type, the training pipeline compares:

- XGBoost regressor
- Random Forest regressor

The model is trained on `log(price)` and predictions are transformed back to dollars.

Selection rule:

- choose the model family with the lower cross-validation MAE for that property type

Validation:

- stratified train/holdout split by price band when possible
- adaptive 3-fold or 5-fold cross-validation depending on sample size
- holdout MAE, MAPE, RMSE, and R2
- bootstrap summary on holdout predictions
- missingness and outlier-removal summaries

## Why The Uplift Part Uses Seattle Repeat Sales

A true renovation-uplift model needs examples like:

```text
same property -> pre-renovation state -> renovation event -> resale within 6-12 months
```

The current Vancouver listing dataset does not contain those before/after resale labels. Instead of inventing fake labels or using assessment proxies, the app trains the uplift layer only when real Seattle/King County CSVs are available locally.

The Seattle uplift model builds observed rows from:

- Seattle building permits as renovation signals
- King County sale records as before/after prices
- King County residential building data as property features
- market-adjusted uplift percentage as the target

If those real CSVs are missing, the model returns `data-missing` instead of training on generated or proxy data.

## App Structure

```text
React website -> Express API -> Python model service
```

- `artifacts/home-value-planner/`: React + Vite + Tailwind website
- `artifacts/api-server/`: Express 5 API, validation, deal analysis, planner logic, project explainer
- `artifacts/model-service/`: Python model training and inference for the base price model and Seattle observed uplift model
- `artifacts/openapi/`: API documentation snapshot
- `docs/`: technical guide and uplift dataset research notes
- `src/` and `assets/`: archived Dash prototype, not used by the current app

Important files:

- [`artifacts/model-service/service.py`](artifacts/model-service/service.py): data cleaning, feature engineering, model training, evaluation, and inference
- [`artifacts/model-service/uplift_service.py`](artifacts/model-service/uplift_service.py): real-data-only Seattle repeat-sale uplift model
- [`artifacts/api-server/src/model.ts`](artifacts/api-server/src/model.ts): API orchestration between estimate, simulate, and plan
- [`artifacts/api-server/src/dealAnalysis.ts`](artifacts/api-server/src/dealAnalysis.ts): investor deal math and risk labels
- [`artifacts/api-server/src/assistant.ts`](artifacts/api-server/src/assistant.ts): cited project explainer over local docs
- [`artifacts/home-value-planner/src/pages/EstimatePage.tsx`](artifacts/home-value-planner/src/pages/EstimatePage.tsx): homeowner-facing model result and trust summary
- [`artifacts/home-value-planner/src/pages/DealAnalyzerPage.tsx`](artifacts/home-value-planner/src/pages/DealAnalyzerPage.tsx): investor-facing dashboard homepage
- [`docs/model-card.md`](docs/model-card.md): concise data science summary for the base model and uplift limitation
- [`docs/portfolio-case-study.md`](docs/portfolio-case-study.md): resume/interview case-study narrative

## Deployment

A permanent public link is possible, but the full app needs more than a static frontend. The production version needs:

- a hosted React frontend
- a hosted Express API
- a hosted Python model service
- approved private access to the local model/data files used by the model service

The raw Seattle/King County files and local model artifacts are intentionally not committed to GitHub. This keeps the repo clean and avoids redistributing restricted raw data. For a public demo, the safest path is to deploy the frontend and API to a cloud provider such as Render, Railway, Fly.io, or Vercel, then provide the model service with approved private model artifacts or approved private data storage.

See [`docs/deployment.md`](docs/deployment.md) for the deployment checklist and required environment variables.

## Run Locally

Copy `.env.example` to `.env` and set your local data path:

```bash
VANCOUVER_LISTINGS_CSV_PATH=/path/to/data_bc.csv
SEATTLE_PERMITS_PATH=/path/to/seattle/building_permits.csv
KING_COUNTY_SALES_PATH=/path/to/king-county/rpsale_extr.csv
KING_COUNTY_BUILDINGS_PATH=/path/to/king-county/resbldg_extr.csv
```

Raw Seattle/King County files should stay local under `data/raw/seattle/` or another private path. They are ignored by git.

Set up the real uplift data:

```bash
python scripts/setup_uplift_data.py --download-seattle
python scripts/setup_uplift_data.py --download-king-county
python scripts/setup_uplift_data.py --validate
```

The first command downloads the public Seattle building permits CSV. The second command downloads the King County assessor ZIP extracts and saves the expected local CSVs:

- `data/raw/seattle/rpsale_extr.csv`
- `data/raw/seattle/resbldg_extr.csv`

You can also download those King County files manually from the Assessor data download page after accepting the County disclaimer. Then run:

```bash
UPLIFT_FORCE_RETRAIN=1 python scripts/setup_uplift_data.py --train
```

Install Python and Node dependencies:

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

If `xgboost` cannot load because `libomp` is missing, the Python service can fall back to Random Forest where supported.

## API Surface

- `GET /health`
- `POST /api/estimate`
- `POST /api/simulate`
- `POST /api/plan`
- `POST /api/deal/analyze`
- `POST /api/assistant/query`

The assistant endpoint is retrieval-first. By default it uses a lightweight local fallback over project docs. Set `PROJECT_ASSISTANT_USE_SENTENCE_BERT=1` after installing Python requirements to query with `sentence-transformers/all-MiniLM-L6-v2`.

## What I Built

I built this project as a full-stack data science dashboard for Vancouver real estate investors. The app estimates a property's current listing value, shows which improvements could increase value, and builds a simple renovation plan around a target price, budget, and timeline.

The main machine learning work is the base price model. I trained property-type-specific models with structured listing data, location features, outlier handling, cross-validation, and holdout evaluation. I also added model-trust summaries so the estimate is easier to understand instead of being just one number.

For renovation uplift, I avoided fake data and proxy labels. The live uplift path only trains from real Seattle/King County permit, sale, and residential-building records, predicts a percentage uplift, and applies that percentage to the Vancouver base estimate.

The final product is a three-step workflow:

1. Estimate the current price.
2. Explore ways to improve value.
3. Build a practical plan.

This project shows my ability to connect data cleaning, feature engineering, model validation, backend API design, and a usable React interface into one portfolio-ready application.

## Next Improvements

1. Add a small model metrics report so results can be reviewed without starting the app.
2. Split `service.py` into smaller modules for cleaning, features, training, and inference.
3. Add unit tests for property-type normalization, postal-code fallback, and Seattle uplift calculations.
4. Replace listing prices with actual sale prices if licensed transaction data becomes available.
5. Add a Vancouver-specific observed uplift dataset if licensed transaction records become available.
