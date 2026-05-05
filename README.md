# Vancouver Housing Price Prediction

This is an applied data science project about estimating Vancouver home listing prices and turning the estimate into an investor-facing deal analyzer.

The project has a working web app, but the main story is the full dashboard workflow: data cleaning, feature engineering, model comparison, validation, investor decision support, and honest communication about where the available data is not enough.

## Project Question

Can we estimate the current value of a Vancouver home from structured listing features?

Secondary question:

Can we estimate renovation uplift? Not with the current dataset in a defensible ML way, because the data does not contain before/after resale outcomes. For now, the uplift section is a transparent rule-based planning calculator, not a trained model.

## Current Scope

- City: Vancouver only
- Property types: `Condo`, `Detached`, `Townhouse`, `Duplex`
- Target for the ML model: listing price
- Inputs: postal code, property type, living area, bedrooms, bathrooms, optional property tax
- Investor workflow: asking-price comparison, value gap, renovation budget, timeline, risk flags, and gross upside before transaction costs
- Uplift/planning: deterministic rules based on published renovation cost-recovery patterns, property-type fit, timeline, and local price ceilings

Important limitations:

- The base model predicts listing price, not verified sale price.
- The uplift calculator is not a causal ML model.
- Outputs are for portfolio/demo and planning exploration, not financial advice.
- Deal verdicts are screening aids, not buy/sell recommendations.

## Data Science Work

### Dataset

The base model uses a Vancouver subset of `data_bc.csv`.

Cleaning steps:

- filter `addressLocality == "Vancouver"`
- keep only the four supported residential property types
- parse price, square footage, beds, baths, postal code, latitude, longitude, and property tax
- remove rows missing the core pricing fields
- remove extreme outliers by property type using price-per-square-foot and living-area checks

### Feature Engineering

The model uses structured features only:

- numeric: living area, bedrooms, bathrooms, latitude, longitude, property tax
- location: postal FSA, full postal-code/FSA centroid fallbacks
- engineered map features: `lat_x_lon`, `lat_sq`, `lon_sq`
- local submarket cluster: KMeans cluster from Vancouver coordinates

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

## Why The Uplift Part Is Rule-Based

A true renovation-uplift model needs examples like:

```text
same property -> pre-renovation state -> renovation event -> resale within 6-12 months
```

The current listing dataset does not contain those before/after resale labels. Instead of pretending we have a causal model, the app uses a simpler rule engine for renovation scenarios.

The rule engine estimates directional uplift from:

- expected cost recovery by renovation type
- whether the project fits the property type
- timeline feasibility
- diminishing returns when many projects are selected
- local market ceiling guardrails

The next data science upgrade would be to acquire property-level transaction data, join it to permit and assessment records, and train a real second-stage uplift model.

## App Structure

```text
React website -> Express API -> Python model service
```

- `artifacts/home-value-planner/`: React + Vite + Tailwind website
- `artifacts/api-server/`: Express 5 API, validation, deal analysis, rule-based uplift, planner logic, project explainer
- `artifacts/model-service/`: Python model training and inference for the base price model
- `artifacts/openapi/`: API documentation snapshot
- `docs/`: technical guide and uplift dataset research notes
- `src/` and `assets/`: archived Dash prototype, not used by the current app

Important files:

- [`artifacts/model-service/service.py`](artifacts/model-service/service.py): data cleaning, feature engineering, model training, evaluation, and inference
- [`artifacts/api-server/src/ruleBasedUplift.ts`](artifacts/api-server/src/ruleBasedUplift.ts): transparent renovation-uplift rule engine
- [`artifacts/api-server/src/model.ts`](artifacts/api-server/src/model.ts): API orchestration between estimate, simulate, and plan
- [`artifacts/api-server/src/dealAnalysis.ts`](artifacts/api-server/src/dealAnalysis.ts): investor deal math and risk labels
- [`artifacts/api-server/src/assistant.ts`](artifacts/api-server/src/assistant.ts): cited project explainer over local docs
- [`artifacts/home-value-planner/src/pages/EstimatePage.tsx`](artifacts/home-value-planner/src/pages/EstimatePage.tsx): homeowner-facing model result and trust summary
- [`artifacts/home-value-planner/src/pages/DealAnalyzerPage.tsx`](artifacts/home-value-planner/src/pages/DealAnalyzerPage.tsx): investor-facing dashboard homepage
- [`docs/model-card.md`](docs/model-card.md): concise data science summary for the base model and uplift limitation
- [`docs/portfolio-case-study.md`](docs/portfolio-case-study.md): resume/interview case-study narrative

## Run Locally

Copy `.env.example` to `.env` and set your local data path:

```bash
VANCOUVER_LISTINGS_CSV_PATH=/path/to/data_bc.csv
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

## How I Would Present This Project

Resume version:

> Built a Vancouver housing price prediction app using Python, XGBoost/Random Forest, Express, and React. Trained property-type-specific models on structured listing data with location features, cross-validation, holdout evaluation, outlier handling, and model-trust summaries. Added a transparent rule-based renovation planner after identifying that the available dataset did not support causal uplift modeling.

Interview version:

- The strongest data science part is the base price model.
- The most important judgment call was not training an unsupported uplift model from the wrong data.
- The product layer exists to make the model understandable to non-technical users.
- The next step is replacing listing-price targets with actual sale-price data, then building before/after resale labels for true uplift modeling.

## Next Improvements

1. Add a small model metrics report so results can be reviewed without starting the app.
2. Split `service.py` into smaller modules for cleaning, features, training, and inference.
3. Add unit tests for property-type normalization, postal-code fallback, and rule-based uplift calculations.
4. Replace listing prices with actual sale prices if licensed transaction data becomes available.
5. Build a real uplift dataset from sale records, permits, and assessment history.
