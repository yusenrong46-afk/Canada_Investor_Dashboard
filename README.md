# Canada Investor Dashboard

A full-stack real estate analytics dashboard that estimates Vancouver property value, evaluates renovation upside, and generates investor-facing action plans through an Estimate -> Improve -> Plan workflow.

GitHub: https://github.com/yusenrong46-afk/Canada_Investor_Dashboard

## Why I Built This

Real estate investors often compare properties using messy, fragmented data: listings, public records, permits, property features, location signals, renovation assumptions, and model outputs. This project turns those inputs into a clean decision-support workflow.

I built it as a portfolio project for Data Analyst, BI Analyst, Analytics Engineer, and Junior Data Scientist roles in Canada.

## What It Does

1. Estimates current property value from structured listing/property features.
2. Shows model confidence, warnings, and data-quality issues.
3. Simulates renovation value uplift using available repeat-sale / permit-style data.
4. Generates an investment action plan based on budget, target price, timeline, and risk flags.
5. Provides transparent data-quality checks instead of hiding missing or weak inputs.

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
React / TypeScript frontend
  /estimate          Estimate current listing value
  /improve           Test renovation uplift
  /plan              Build an investor action plan
  /workspace         Save and compare user-created scenarios
  /insights          Market & Investment Insights
  /deal-analyzer     Advanced one-page deal screening
  /model-data-story  Static model and data explanation

Express API
  GET  /health
  POST /api/estimate
  POST /api/simulate
  POST /api/plan
  POST /api/deal/analyze

Python model service
  /estimate  Vancouver listing-price model
  /uplift    observed renovation-uplift model
```

Main folders:

```text
artifacts/shared/              shared TypeScript schemas and types
artifacts/home-value-planner/  React dashboard
artifacts/api-server/          Express API
artifacts/model-service/       Python Flask model service
data/processed/                demo-safe processed training summaries
demo/                          public sample outputs for demo mode
docs/                          portfolio documentation
reports/                       generated model and data-quality reports
tests/                         focused Python tests
legacy/                        older experiments moved out of the active app
```

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind, Recharts
- API: Express.js, Zod validation
- Model service: Python, Flask, pandas, scikit-learn, XGBoost when available
- Reports/tests: pytest, Vitest, Markdown report scripts
- Data workflow: cleaned Vancouver listing-style data and Seattle/King County repeat-sale style uplift data
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
- Render deployment config is included as an optional separate API host if I want it later.
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

## Screenshots

Placeholder paths:

- `docs/screenshots/estimate-page.png`
- `docs/screenshots/improve-page.png`
- `docs/screenshots/plan-page.png`
- `docs/screenshots/insights-page.png`
- `docs/screenshots/deal-analyzer-page.png`
- `docs/demo-script.md`

## Reports

Generate the model report:

```bash
.venv/bin/python scripts/generate_model_report.py
```

Generate the data-quality report:

```bash
.venv/bin/python scripts/generate_data_quality_report.py
```

The scripts do not invent missing metrics. If a model artifact or data file is missing, the report says exactly what is missing.

## Limitations

- The base model predicts listing price, not final sale price.
- The app is useful for screening and explanation, not appraisal or lending decisions.
- Renovation uplift uses transferred observed assumptions from Seattle/King County style repeat-sale data because the current Vancouver dataset does not contain clean before/after renovation labels.
- Demo mode uses precomputed sample outputs so the dashboard can be reviewed publicly without private data or local model artifacts.
- Public mode is interactive, but it is still a screening model and not an appraisal.
- Some local data sources are unavailable unless I provide them through environment variables.
- Transaction costs, taxes, financing, strata rules, exact condition, and seller motivation still need manual review.

## Future Improvements

- Add better Vancouver sale-price data.
- Join local renovation permits to property-level sales history.
- Improve geospatial features with parcels, zoning, transit, and neighbourhood data.
- Add saved projects and authentication.
- Add a full live-mode deployment after the Python model service and data pipeline are ready for public hosting.
- Add more automated checks around API contracts and report generation.
- Use `docs/demo-script.md` to practice the interview walkthrough.

## Interview Summary

My 30-second explanation:

> I built a full-stack real estate analytics dashboard that helps users estimate Vancouver listing value, evaluate renovation upside, and turn messy property data into an investment plan. The main thing I wanted to show is not just a model, but how model outputs can become a decision workflow with data-quality checks, clear limitations, and business-facing insights.
