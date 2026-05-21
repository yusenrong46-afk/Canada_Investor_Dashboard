# Deployment Notes

This is not a static-only app. The full product has three runtime services:

1. React/Vite frontend
2. Express API
3. Python model service

## Current Public API

The frontend now only needs:

```text
GET  /health
POST /api/deal/analyze
POST /api/assistant/query
```

The Express API still calls the Python model service internally:

```text
POST /estimate
POST /uplift
```

## Recommended Hosting

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

Most hosts provide `PORT` automatically. The API and model service respect `PORT`.

## Data And Model Files

Do not commit these:

- `data/raw/`
- `artifacts/model-service/models/`
- raw Seattle/King County assessor extracts
- `legacy/model-artifacts/`

For a public demo, I would mount approved private model artifacts into `artifacts/model-service/models/`. If the real uplift CSVs are unavailable, the app should keep returning `data-missing` instead of showing fake uplift.

## Local Pre-Deploy Check

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

Add a live demo link only after the deployed API returns a successful response for `POST /api/deal/analyze`.
