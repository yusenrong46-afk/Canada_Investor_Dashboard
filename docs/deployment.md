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
  "mode": "public-interactive",
  "contractVersion": "2026-07-18.v1"
}
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
VANCOUVER_MODEL_ARTIFACT_PATH=/path/to/vancouver_base_price_bundle_v5.pkl
HALIFAX_TRAINING_CSV_PATH=/path/to/halifax_base_model_training.csv
HALIFAX_MODEL_ARTIFACT_PATH=/path/to/halifax_base_price_bundle_v1.pkl
SEATTLE_PERMITS_PATH=/path/to/seattle/building_permits.csv
KING_COUNTY_SALES_PATH=/path/to/king-county/rpsale_extr.csv
KING_COUNTY_BUILDINGS_PATH=/path/to/king-county/resbldg_extr.csv
SEATTLE_UPLIFT_MODEL_ARTIFACT_PATH=/path/to/seattle_observed_uplift_bundle_v2.pkl
```

Production entrypoint for the Python model service (when deployed outside this repo's Vercel public mode):

```bash
cd artifacts/model-service
gunicorn -w 1 --timeout 60 app:app
```

Use Python 3.11 with the pinned dependencies from `requirements.txt`. Approved model bundles must match checksums listed in `artifacts/model-service/models/MANIFEST.json`.

Training is an explicit offline step. The inference service never trains, repairs, or silently replaces an artifact:

```bash
.venv/bin/python scripts/train_model_bundles.py --component all
```

Deploy the resulting versioned files under `artifacts/model-service/models/` or point the artifact-path variables at an approved immutable copy. Service startup fails when a required base-model artifact is missing or incompatible; uplift reports `data-missing` when its approved artifact is unavailable.

## Release checklist

Use this sequence for every promote to production:

1. **release-gate green** — GitHub Actions `Release gate` passes (Node typecheck/tests/Vercel builds, public `--api-only` smoke on localhost:4010, Python pytest).
2. **Preview deploy** — Deploy the exact commit under review to a Vercel Preview URL.
3. **Preview smoke (full 9/9)** — `pnpm smoke:public-release -- https://<preview-url>` (includes UI shell + API). Use `VERCEL_AUTOMATION_BYPASS_SECRET` or `vercel curl` if Deployment Protection is on.
4. **Promote** — Promote that exact Preview deployment. Do not rebuild a different commit for production.
5. **Production smoke (full 9/9)** — `pnpm smoke:public-release -- https://canadian-investor-dashboard.vercel.app` (or the current production alias) and spot-check Estimate → Improve → Plan → Deal.

Local API-only reproduction of the CI smoke step:

```bash
pnpm --filter @vvl/api-server build
PUBLIC_MODE=true DEMO_MODE=false API_HOST=127.0.0.1 API_PORT=4010 node artifacts/api-server/dist/index.cjs &
pnpm smoke:public-release -- http://127.0.0.1:4010 --api-only
```

## Deployment Steps

1. Push a reviewed release branch to GitHub.
2. In Vercel, import the GitHub repo with the repo root as the project root, or run `vercel` from that branch to create a Preview deployment.
3. Inspect the Preview build and runtime logs, then run the automated release smoke gate against its URL.
4. Open `/estimate`, `/deal-analyzer`, `/workspace`, and `/insights` on Preview and confirm the mode line makes public rules / not-an-appraisal clear.
5. Promote that exact verified Preview deployment. Do not rebuild a different commit for production.
6. Run the same automated gate and route review against the production URL.

## Smoke Test

Run the complete contract and truth-semantics matrix against Preview and again after promotion:

```bash
pnpm smoke:public-release -- https://<vercel-site-url>
```

The gate checks the web shell, security headers, both supported markets, request validation, the health contract, estimate/simulation/plan/deal provenance, safe decision vocabulary, separate gross and net upside, honest stress-test labels, and the `409` response that prevents fabricated portfolio Insights.

If Vercel Deployment Protection is enabled on Preview, anonymous smoke calls return 401. Use either:

```bash
# Authenticated curl helper (preferred for Preview)
npx vercel curl /api/health --deployment <preview-host> --yes -- -sS

# Or set the project Automation Bypass secret for scripts/smoke_public_release.mjs
export VERCEL_AUTOMATION_BYPASS_SECRET=...
pnpm smoke:public-release -- https://<preview-url>
```

The script sends the bypass secret only in Vercel's protection-bypass header.

## Content Security Policy note

Production and Preview now send an enforced `Content-Security-Policy` (see below). If a deploy breaks fonts/map tiles, temporarily switch both `vercel.json` and `artifacts/api-server/src/app.ts` back to `Content-Security-Policy-Report-Only`, inspect violations, then re-enforce.

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

## Content Security Policy

The hosted frontend and Express API send the same enforced `Content-Security-Policy` header (see `vercel.json` and `artifacts/api-server/src/app.ts`). It allows same-origin scripts, inline styles for Tailwind, Google Fonts, and OpenStreetMap tiles for the market map.

If a future dependency needs another origin, update both header locations together and redeploy. During rollout you can temporarily switch back to `Content-Security-Policy-Report-Only` and inspect violation reports in the browser console or Vercel logs before re-enforcing.

## Manual Review Before Publishing

- Confirm public interactive mode is enabled.
- Confirm no private raw-data paths appear in the UI.
- Confirm reports do not claim unavailable metrics.
- Confirm README limitations are visible.
