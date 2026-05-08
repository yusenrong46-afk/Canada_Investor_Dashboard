# Deployment Notes

This project can be deployed, but the full dashboard is not a static-only app. It has three runtime parts:

1. React/Vite frontend
2. Express API
3. Python model service

## Recommended Setup

Use three hosted services:

- Frontend: Vercel, Netlify, or Render Static Site
- API: Render, Railway, Fly.io, or another Node web service
- Model service: Render, Railway, Fly.io, or another Python web service

## Environment Variables

Frontend:

```bash
VITE_API_BASE_URL=https://your-api-service.example.com/api
```

API:

```bash
MODEL_SERVICE_URL=https://your-model-service.example.com
API_HOST=0.0.0.0
```

Model service:

```bash
MODEL_SERVICE_HOST=0.0.0.0
MODEL_SERVICE_FORCE_RETRAIN=0
UPLIFT_FORCE_RETRAIN=0
```

Most hosts provide `PORT` automatically. The API and model service now respect `PORT`, so a separate port value is usually not needed in production.

## Data And Model Files

Do not commit these to GitHub:

- `data/raw/`
- `artifacts/model-service/models/`
- raw Seattle/King County assessor extracts

For a public demo, either:

- mount approved private model artifacts into `artifacts/model-service/models/`, or
- provide approved private data access and run the training/setup commands during deployment.

The project should keep returning `data-missing` if the real model inputs are unavailable. That is intentional and protects the project from fake data.

## Local Pre-Deploy Check

Run this before deploying:

```bash
pnpm typecheck
pnpm test
pnpm build
PYTHONPYCACHEPREFIX=/private/tmp/codex_pycache .venv/bin/python -m pytest
```

## Resume Link Recommendation

Use the GitHub link immediately:

```text
https://github.com/yusenrong46-afk/Canada_Investor_Dashboard
```

Add a live demo link only after the frontend, API, and model service are all deployed and the deployed API returns `status: "ready"` for `/api/simulate`.
