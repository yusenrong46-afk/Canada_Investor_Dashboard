# Deployment Notes

## Goal

For a public portfolio demo, I would deploy this project in demo mode first.

Demo mode is safer because it does not require private raw data, local model artifacts, or my machine-specific data paths.

## Services

The project has three services:

- React frontend
- Express API
- Python model service

In live local mode, the Express API calls the Python model service.

In demo mode, the Express API returns stable sample JSON from `demo/` and does not need the Python service.

## Environment Variables

API:

```bash
DEMO_MODE=true
API_PORT=4000
MODEL_SERVICE_URL=http://127.0.0.1:5001
```

Frontend:

```bash
VITE_DEMO_MODE=true
VITE_API_BASE_URL=/api
```

Python model service:

```bash
VANCOUVER_LISTINGS_CSV_PATH=/path/to/data_bc.csv
SEATTLE_PERMITS_PATH=/path/to/seattle/building_permits.csv
KING_COUNTY_SALES_PATH=/path/to/king-county/rpsale_extr.csv
KING_COUNTY_BUILDINGS_PATH=/path/to/king-county/resbldg_extr.csv
```

## Public Demo Recommendation

Use:

```bash
DEMO_MODE=true
VITE_DEMO_MODE=true
```

This lets reviewers open the dashboard and see the full workflow without private data.

The UI banner makes the limitation visible:

```text
Demo Mode: This version uses precomputed sample outputs so the dashboard can be reviewed publicly without private data or model artifacts.
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

- Confirm demo mode is enabled.
- Confirm no private raw-data paths appear in the UI.
- Confirm reports do not claim unavailable metrics.
- Confirm README limitations are visible.
- Add screenshots under `docs/screenshots/` if I want a stronger GitHub preview.
