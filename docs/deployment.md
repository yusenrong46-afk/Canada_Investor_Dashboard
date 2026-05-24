# Deployment Notes

## Goal

For a public portfolio version, I deploy this project in public interactive mode first.

Public interactive mode is safer than full live mode because it does not require private raw data, local model artifacts, or my machine-specific data paths. It is still interactive: estimates, uplift, plans, deal labels, and insights respond to user inputs.

## Public Demo Setup

The simplest public setup is:

- Vercel for the React/Vite frontend
- Vercel serverless functions for the Express API demo endpoints
- Public interactive mode enabled by default

I am not deploying the Python model service for the public version yet. In public mode, the API calculates results with a transparent TypeScript screening engine and does not need private data or local model artifacts.

## Why This Setup

This is the cleanest recruiter-friendly version because:

- reviewers get a working link
- the app does not depend on my laptop
- private/local raw data is not exposed
- the dashboard still shows the Estimate -> Improve -> Plan workflow
- model and data limitations stay visible through the public-mode banner and docs

## Vercel Frontend And API

The repo includes `vercel.json` for the frontend build and `api/[...path].js` for the public interactive API adapter.

Vercel settings:

- Framework preset: Vite
- Root directory: repo root
- Install command: `corepack enable && corepack pnpm install --frozen-lockfile`
- Build command: `corepack pnpm --filter @vvl/api-server build:vercel && VITE_DEMO_MODE=false VITE_PUBLIC_MODE=true corepack pnpm --filter @vvl/home-value-planner build`
- Output directory: `artifacts/home-value-planner/dist`

The Vercel adapter sets `PUBLIC_MODE=true` by default so the hosted API can calculate interactive screening results without the Python model service.

After Vercel deploys, the API should respond at:

```text
https://<vercel-site-url>/api/health
```

The expected health response includes:

```json
{
  "ok": true,
  "service": "api-server",
  "mode": "public-interactive-estimator"
}
```

## Optional Render API

The repo also includes `render.yaml` in case I want a separate always-on API service later.

Render settings:

- Service type: Web Service
- Runtime: Node
- Branch: `main`
- Build command: `corepack enable && corepack pnpm install --frozen-lockfile && corepack pnpm --filter @vvl/api-server build`
- Start command: `node artifacts/api-server/dist/index.cjs`
- Health check path: `/health`

Render environment variables:

```bash
DEMO_MODE=false
PUBLIC_MODE=true
API_HOST=0.0.0.0
NODE_VERSION=24
```

After Render deploys, the API should respond at:

```text
https://<render-service-url>/health
```

The expected health response includes:

```json
{
  "ok": true,
  "service": "api-server",
  "mode": "public-interactive-estimator"
}
```

If I choose the optional Render API setup, I should set this Vercel environment variable:

```bash
VITE_API_BASE_URL=https://<render-service-url>/api
```

For the Vercel-only public version, leave `VITE_API_BASE_URL` unset so the frontend uses `/api` on the same public domain.

## Live Local Mode

Live local mode still uses all three services:

- React frontend
- Express API
- Python model service

Local API variables:

```bash
DEMO_MODE=false
PUBLIC_MODE=false
API_PORT=4000
MODEL_SERVICE_URL=http://127.0.0.1:5001
```

Local frontend variables:

```bash
VITE_DEMO_MODE=false
VITE_PUBLIC_MODE=false
VITE_API_BASE_URL=/api
```

Python model service variables:

```bash
VANCOUVER_LISTINGS_CSV_PATH=/path/to/data_bc.csv
SEATTLE_PERMITS_PATH=/path/to/seattle/building_permits.csv
KING_COUNTY_SALES_PATH=/path/to/king-county/rpsale_extr.csv
KING_COUNTY_BUILDINGS_PATH=/path/to/king-county/resbldg_extr.csv
```

## Deployment Steps

1. Push `main` to GitHub.
2. In Vercel, import the GitHub repo or run `vercel --prod` from the repo root.
3. Use the repo root as the Vercel root directory.
4. Open `/estimate`, `/deal-analyzer`, `/workspace`, and `/insights`.
5. Confirm the banner says:

```text
Public Interactive Mode: estimates update from your inputs using a transparent screening model. Use it for deal review, not appraisal or lending decisions.
```

## Smoke Test

Use these checks after deployment:

```bash
curl https://<vercel-site-url>/api/health
curl -X POST https://<vercel-site-url>/api/estimate \
  -H "Content-Type: application/json" \
  -d '{"postalCode":"V6B 1X9","propertyType":"Condo","livingAreaSqft":708,"bedrooms":1,"bathrooms":1,"yearBuilt":2012}'
```

## Build Commands

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

Python checks:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/codex_pycache .venv/bin/python -m pytest
.venv/bin/python scripts/generate_model_report.py
.venv/bin/python scripts/generate_data_quality_report.py
```

## Manual Review Before Publishing

- Confirm public interactive mode is enabled.
- Confirm no private raw-data paths appear in the UI.
- Confirm reports do not claim unavailable metrics.
- Confirm README limitations are visible.
- Add screenshots under `docs/screenshots/` if I want a stronger GitHub preview.
