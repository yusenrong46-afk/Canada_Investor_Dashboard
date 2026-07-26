# Contributor notes

Full-stack Canadian real-estate dashboard: React/Vite UI, Express API, Python Flask model service.

| Path | Role |
|---|---|
| `artifacts/home-value-planner` | Frontend + API client |
| `artifacts/api-server` | Express API, Zod contracts |
| `artifacts/model-service` | Vancouver, Halifax, uplift models |
| `scripts/` | Build, export, report scripts |
| `analytics/warehouse` | DuckDB SQL + marts |

**Runtime modes**

- `DEMO_MODE=true` — fixed demo JSON, no inference
- `PUBLIC_MODE=true` — rules engine + committed exports (Vercel default)
- neither flag — live mode, loads approved `.pkl` artifacts

**Setup**

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
corepack enable && pnpm install
```

**Checks**

```bash
pnpm check
python -m pytest -q
python scripts/build_all.py --strict
python scripts/verify_generated_outputs.py
```

**Generated artifacts** — regenerate, don't edit by hand:

- `data/exports/*.json`
- `reports/*.md`
- `data/warehouse/property_analytics.duckdb`

**Don't**

- weaken tests or CI gates
- train models on API startup or per request
- present public/demo responses as fitted ML

Keep shared contracts in `artifacts/shared`, preserve provenance/evidence fields, and avoid `/Users/...` paths in committed outputs.
