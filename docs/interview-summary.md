# Interview Summary — Canada Investor Dashboard

## 30-Second Explanation

Canada Value Lab is a multi-market investor screening dashboard for Vancouver and Halifax/Maritimes. You estimate current value, test renovation upside, build a plan, and screen a deal — with explicit provenance so reviewers know whether a number came from public rules, observed evidence, or a fitted local model.

**Live demo:** https://canadian-investor-dashboard.vercel.app  
(GitHub: https://github.com/yusenrong46-afk/Canada_Investor_Dashboard)

## What I Built

- React/TypeScript dashboard (Estimate → Improve → Plan → Deal, plus Scenarios, Insights, Map, Model story)
- Express REST API with shared Zod contracts and three runtime modes
- Python Flask model service for local live inference (conformal intervals, SHAP drivers)
- DuckDB analytics warehouse → committed exports (evidence, map, trend, experiments, Halifax uplift)
- Data autopsy / cleaning reports and model-card documentation
- Scenario workspace in browser localStorage (no server-side portfolio on G1)
- Vercel public deploy with a 9-check release smoke gate; the release candidate includes that gate, and the public production URL uses it after the verified Preview is promoted

## Runtime modes (say this clearly)

| Mode | Where | What calculates |
|---|---|---|
| **Public** | Vercel production | TypeScript screening rules + committed JSON exports — **not** fitted pickles |
| **Live** | Local Express + Flask | Fitted Vancouver/Halifax base models + uplift layers |
| **Demo** | `DEMO_MODE=true` | Precomputed Vancouver sample JSON |

## Market truth

- **Vancouver:** listing-price screening (V5/V6 FSAs with committed public profiles).
- **Halifax / Maritimes:** time-adjusted sale-price screening from PVSC evidence (B-prefix FSAs with committed evidence rows; no condo coverage).
- Renovation uplift is **gross** sale-price impact, not net return after costs.
- Deal stress-test shares are assumption diagnostics, **not** calibrated probabilities.

## What I Learned

- How to connect ML and warehouse outputs to a decision workflow without overselling certainty
- How to keep public demo honesty when private pickles cannot ship
- How to handle messy multi-source Canadian property data and document gaps
- How to design APIs around a versioned response contract and provenance labels
- How to gate a portfolio release with automated smoke checks, not screenshots alone

## Limitations

- Public Vercel mode is a rules/screening engine, not the fitted XGBoost/Random Forest bundles.
- Vancouver predicts listing-style value in public/live listing models — not a proven final sale price.
- Vancouver temporal retrain is blocked until listing dates exist in the available raw source.
- Vancouver renovation uplift uses a Seattle/King County observed proxy (transferred evidence).
- Halifax uplift is observational repeat-sale × permit evidence (descriptive, wide outcome spread).
- Insights/scenarios are browser-local on G1 — public/live return `409` for server-side portfolio.
- Screening support only — not an appraisal, CMA, or lending decision.

## What I Would Improve Next

- G2: Postgres-backed cases, auth, and recoverable scenario history
- G3: Cost-complete deal engine (financing, carrying, tax, exit) with golden reconciliation cases
- Vancouver dated listings → honest temporal holdout retrain for the live bundle
- Stronger local uplift labels for Vancouver before treating uplift as transportable
- Distributed rate limits and deeper observability once persistence lands
