# Backend execution goals and evidence ledger

Last updated: 2026-07-22

## Program objective

Turn the current research-quality dashboard backend into a truthful resume release, then a persistent and observable platform, then a cost-complete decision engine. The moat and any LLM layer remain out of scope until G1-G3 pass.

## Status vocabulary

- `pending`: not started or not inspected.
- `in progress`: implementation exists but the release evidence is incomplete.
- `verified`: direct evidence proves the requirement.
- `blocked`: execution cannot proceed without an external decision or state change.

## G1 — Resume-release truth pass

Status: **verified**

### G1.1 Versioned output contract

- [x] Estimate, simulate, plan, deal, health, and insights have explicit runtime schemas.
- [x] Calculation responses expose engine type, evidence level, validation status, version, data-as-of, source IDs, and limitations.
- [x] Express validates Python model-service responses instead of type-casting unknown JSON.
- [x] Contract version is visible from health and covered by tests.

### G1.2 Truthful production semantics

- [x] Public rules never identify themselves as fitted models.
- [x] Formula-driven uplift is labelled `assumption`, not `observed`.
- [x] Halifax permit-linked descriptive evidence remains distinguishable from causal or fitted-model evidence.
- [x] Demo results are labelled precomputed and cannot inherit live-model validation claims.
- [x] Deal output does not use calibrated-probability language for the triangular stress test.
- [x] Strong recommendation language is disabled until G3 passes.
- [x] Starter Insights are hidden from the real workflow or unmistakably labelled demonstration data.

### G1.3 Resume release gate

- [x] Focused contract and semantics tests pass.
- [x] Full API, shared-package, frontend, and Python suites pass.
- [x] Production `/api/health`, `/api/estimate`, `/api/simulate`, `/api/plan`, `/api/deal/analyze`, and `/api/insights` match the contract.
- [x] High dependency advisories are fixed or accompanied by a written exploitability decision.
- [x] Production no longer returns stale public-model or gross-upside claims.

## G2 — Persistent and observable backend foundation

Status: **pending**

### G2.1 Domain and persistence

- [ ] Versioned records exist for users, properties, cases, evidence items, assumptions, model runs, decision snapshots, and outcomes.
- [ ] Postgres is the source of truth; browser storage is only a safe cache or guest draft.
- [ ] Authenticated users can recover a case in another browser.
- [ ] A guest path exists without silently creating fake portfolio history.
- [ ] Migrations, ownership rules, retention, and deletion behaviour are tested.

### G2.2 Unified services

- [ ] Public rules and fitted models implement one validated adapter contract.
- [ ] Duplicated plan/deal orchestration is consolidated into one deterministic decision layer.
- [x] Model training is offline-only; inference loads an approved immutable artifact.
- [ ] Artifacts and datasets have checksums, versions, promotion state, and reproducible environment metadata.

### G2.3 Operations and release gate

- [ ] Every request has a request ID; every calculation has a case ID and model-run ID.
- [ ] Structured logs, latency, error categories, engine version, and readiness are observable.
- [ ] Liveness and readiness are separate; unhealthy dependencies cannot report a healthy service.
- [ ] Distributed per-user/IP quotas protect expensive endpoints.
- [ ] Failure injection, concurrency, recovery, and cross-browser persistence tests pass.
- [ ] Every displayed result can be reproduced from its stored record.

## G3 — Decision correctness

Status: **pending**

### G3.1 Cost-complete contract

- [ ] Purchase, closing, financing, renovation, contingency, carrying, tax, insurance, utilities, maintenance, rent, vacancy, operating, selling, and exit assumptions are explicit inputs.
- [ ] Valuation is separate from investment-return calculation.
- [ ] Targets come from the user; the backend does not invent an automatic percentage target.
- [ ] All defaults are visible, versioned, editable, and covered by tests.

### G3.2 Deterministic decision engine

- [ ] A pure deterministic engine produces cash flow, total basis, net proceeds, return, and break-even outputs.
- [ ] Downside, base, and upside scenarios are clearly labelled assumptions.
- [ ] Hidden thresholds are removed from recommendation labels.
- [ ] At least 20 hand-calculated golden cases reconcile with the engine.
- [ ] Property-based tests cover monotonicity and boundary invariants.

### G3.3 Uncertainty and release gate

- [ ] Value, uplift, cost, and duration uncertainty are modeled separately with justified dependencies.
- [ ] Probability language is used only after held-out calibration demonstrates coverage.
- [ ] Decision labels are backtested and tied to conservative, cost-complete results.
- [ ] Saved cases reproduce the exact decision and explanation.
- [ ] Production release tests prove that gross appreciation is never presented as net return.

## Current execution slice

Goal: **G2.1 — Domain and persistence**

G1 is verified in production. Next work starts the persistent backend foundation without weakening the truthful public contract.

Planned evidence:

1. Versioned domain records for users, properties, cases, evidence, assumptions, model runs, decision snapshots, and outcomes.
2. Postgres as source of truth with browser storage limited to cache or guest draft.
3. Authenticated cross-browser case recovery plus a guest path that does not invent portfolio history.
4. Migration, ownership, retention, and deletion tests.

## Evidence log

### 2026-07-18 — Program initialization

- Created `docs/backend-execution-loop.md` as the persistent execution prompt.
- Created this goal hierarchy and release-gate ledger.
- Current worktree already contains partial truth, cost-awareness, CORS, timeout, and error-handling changes; they remain `in progress` until the G1 production gate passes.
- Next action: implement and test the G1.1 provenance contract without overwriting unrelated worktree changes.

### 2026-07-18 — G1.1 contract foundation verified locally

- Added `artifacts/shared/src/provenance.ts` with contract version `2026-07-18.v1`, engine/evidence/validation vocabularies, contradiction guards, and a reusable provenance constructor.
- Added `artifacts/shared/src/responseSchemas.ts` with runtime schemas for estimate, simulate, plan, deal, health, and insights.
- Added required provenance to public rules, demo samples, live fitted-model adapters, composite plans, composite deals, and Insights responses.
- Express now validates successful Python `/estimate` and `/uplift` payloads before they enter calculation logic.
- Added `artifacts/api-server/src/provenance.test.ts`; the API suite passes 108/108 tests across 14 files.
- Shared, API, and frontend TypeScript checks pass. Python passes 74/74 tests; the existing urllib3/LibreSSL and matplotlib deprecation warnings remain.
- Real local live-stack smoke on ports 4010/5001 passed health, estimate, simulate, plan, and deal contracts. Vancouver estimate reported `fitted-model/observed/validated`; Seattle-to-Vancouver uplift reported `fitted-model/proxy/descriptive`; plan and deal reported `composite/mixed/unvalidated`.
- The live deal smoke changed the sample from gross `+$54,919` to net `-$10,081` after renovation spend, demonstrating why gross appreciation cannot drive the verdict.
- Production remains unverified and unchanged; G1 is not released.
- Next action: execute G1.2 truth semantics, then rerun the same local gates.

### 2026-07-18 — G1.2 truth semantics implemented

- Demo responses now use `precomputed/none/not-applicable` semantics and sample-range language; they cannot inherit live fitted-model validation claims.
- Renamed the illustrative deal stress-test contract to `seeded-triangular-stress-test`, `positiveUpsideShare`, and `targetAchievableShare`; UI and documentation explicitly say these are assumption-based scenario shares, not calibrated probabilities.
- Removed the `Strong lead` verdict. Until G3 passes, the most favorable verdict is `Worth review` and scenario shortlisting retains conservative gates.
- Public and live `/api/insights` no longer fabricate a portfolio from starter rows. Demo mode alone serves sample metrics; the real workflow uses only scenarios saved by the user in that browser.
- Removed the dead public starter-portfolio generator after routing it out of production.
- Focused truth-semantics coverage includes the public Insights 409 contract and provenance contradiction tests; the complete G1.3 gate is now running.

### 2026-07-18 — G1.3 local release candidate verified

- Verified the repository's pinned deployment toolchain: Node 24.14.1 and pnpm 9.15.2. A pnpm 11 fallback was rejected after it produced an incompatible esbuild command shim; the exact pinned toolchain now installs cleanly with a frozen lockfile.
- Patched React Router to 7.18.1 and overrode `qs` to 6.15.2. `pnpm audit --prod` reports no known vulnerabilities.
- Exact-toolchain TypeScript checks pass for shared, API, and frontend packages. API tests pass 109/109 across 15 files. Python tests pass 74/74; 14 existing LibreSSL and matplotlib deprecation warnings remain.
- The exact Vercel build command passes: the serverless API bundle and public-mode Vite frontend are both produced successfully.
- A compiled local public-mode smoke passed `/health`, `/api/estimate`, `/api/simulate`, `/api/plan`, and `/api/deal/analyze`; every calculation returned contract `2026-07-18.v1` with rules/assumption/unvalidated semantics. `/api/insights` truthfully returned 409 because no server-side user portfolio exists.
- The smoke deal reported gross upside `$77,000` and net upside `$12,000` after planned renovation spend, and returned `Needs caution`; the API no longer conflates gross appreciation with net upside or emits `Strong lead`.
- Production remains unchanged and unverified. The current dirty worktree contains unrelated changes, so deployment must wait for a scoped release set instead of publishing the whole checkout.
- Next action: prepare and review the isolated G1 release scope, deploy it, then run the production endpoint matrix before marking G1 verified.

### 2026-07-18 — G1 release scope isolated and reverified

- Created branch `codex/resume-release-g1` in a separate worktree from the four reviewed multi-market commits already ahead of `origin/main`.
- Copied all tracked candidate changes plus the required provenance schemas, tests, property validation helper, and execution documentation. Generated `audit/` and `mlflow/` folders were explicitly excluded.
- Reinstalled from the frozen lockfile under Node 24.14.1 and pnpm 9.15.2 inside the isolated worktree.
- Reverified 109/109 API tests, 74/74 Python tests, all TypeScript checks, a zero-advisory production audit, and the exact Vercel API/frontend build from the isolated release scope.
- Next action: commit the isolated scope, create a Vercel preview, run the endpoint matrix against that preview, and promote only after it passes.

### 2026-07-18 — Clean-machine CI exposed training during inference

- Opened draft PR #1 from the isolated branch and added a SHA-pinned GitHub Actions release gate for Node 24, pnpm 9, the Vercel build, dependency audit, and Python model-service tests.
- The first remote Node job passed. The first Python job exposed that Vancouver and Halifax `load_bundle()` silently trained when artifacts were absent, using a developer-specific absolute CSV path; the local checkout had masked this defect with private artifacts and files.
- Replaced fallback training with a shared approved-artifact loader. Vancouver and Halifax now fail explicitly on missing, corrupt, wrong-version, or uncalibrated artifacts. Seattle uplift returns an explicit `data-missing` state instead of training during a request.
- Added `scripts/train_model_bundles.py` as the explicit real-data offline training command and connected it to `scripts/build_all.py`.
- Reworked tests to inject minimal bundles for normalization and to invoke real Halifax training explicitly as a slow build test. Added guards proving missing artifacts never call training.
- Updated CI actions to their current Node 24 runtimes. The corrected local gate passes 109/109 API tests, 77/77 Python tests, all TypeScript checks, a zero-advisory audit, and the exact Vercel build.
- The corrected GitHub Actions rerun passes both jobs: 109/109 API tests and 77/77 Python tests, plus all TypeScript, dependency-audit, and exact Vercel build gates.
- Next action: resume the Vercel preview gate after CLI authentication is restored.

### 2026-07-18 — Remote release smoke gate added

- Added `scripts/smoke_public_release.mjs`, a deployment-URL gate for the web shell, versioned health contract, provenance semantics, safe verdict vocabulary, gross/net upside separation, honest stress-test naming, and the absence of a fabricated server-side portfolio.
- The gate passes 6/6 API checks against the compiled G1 release candidate in local public mode.
- The same gate rejects current production on 6/7 checks: the web shell loads, but the deployed API still reports the legacy mode, omits contract provenance, and returns fabricated Insights data.
- Production remains unchanged. The saved `VERCEL_OIDC_TOKEN` is a build identity token and cannot authenticate Vercel CLI deployment; a valid CLI login or `VERCEL_TOKEN` is required before creating Preview.
- Next action: authenticate Vercel CLI, deploy Preview from this isolated branch, run the gate plus runtime-log review, and promote only that verified deployment.

### 2026-07-18 — Remote gate expanded to market, validation, and browser security boundaries

- A live response-header audit found that current production exposes Express and lacks MIME-sniffing, clickjacking, permissions, referrer, and CSP defenses.
- Disabled Express's `x-powered-by` fingerprint and added API security headers. Added matching Vercel headers for the SPA and functions; CSP begins in report-only mode so Preview can surface resource violations before enforcement.
- Replaced the low-level custom `routes` block with equivalent high-level rewrites. The assembled Vercel output now places the continuing security-header rule before filesystem and API/SPA rewrites, so static routes cannot bypass it.
- Expanded the deployed-URL gate from one Vancouver happy path to Halifax FSA evidence and estimate semantics, both advertised markets, a field-level invalid-input response, and the security headers on both HTML and API responses.
- The expanded candidate gate passes 8/8 API checks locally. Current production fails 9/9 full deployment checks, including the newly measured security boundaries, and remains unchanged.
- Next action: authenticate Vercel CLI, create Preview, inspect CSP reports and runtime logs while exercising map and core routes, then run the full gate before promotion.

### 2026-07-22 — G1 production release verified

- Deployed Preview `canadian-investor-dashboard-hdar9qo4r.vercel.app` from clean branch `codex/resume-release-g1` at `2d0fb4d`.
- Preview is SSO-protected, so anonymous `scripts/smoke_public_release.mjs` returns 401; authenticated `vercel curl` matrix passed health (`public-interactive` + `2026-07-18.v1`), Vancouver estimate (`rules/assumption/unvalidated`), Halifax estimate (`rules/mixed/descriptive`), markets, simulate, plan, deal (gross/net separated, `seeded-triangular-stress-test`, no probability wording), Insights 409, validation 400, and security headers including report-only CSP.
- Promoted that verified deployment to production alias `https://canadian-investor-dashboard.vercel.app` (`dpl_522sRiJHznesfDeVTt5djieoEWMZ` / `canadian-investor-dashboard-3f2ifaphw.vercel.app`).
- Production smoke gate passed 9/9: web shell, health contract, estimate, two-market coverage, simulate, plan, deal, no fabricated portfolio (409), and validation boundary.
- G1 status moved to **verified**. Next action: begin G2.1 persistence design without changing the truthful public semantics.

### 2026-07-22 — G1 hardening Phases A–E landed and production-verified

- Committed on `codex/resume-release-g1`: `a20d0a1` (A+C core), `2fc7190` (C remainder), `4978c45` (B), `97b2629` (D), `029ad88` (E).
- Local gates: API 125/125, frontend typecheck green, Python 90/90.
- Preview `canadian-investor-dashboard-r6nlgqi98.vercel.app` verified via authenticated curl matrix; promoted to production.
- Production smoke gate passed 9/9 on https://canadian-investor-dashboard.vercel.app.
- Remaining: Phase E retrain blocked on Python 3.11 + raw Vancouver/Seattle datasets; C7 god-component extraction deferred.
- Next action: retrain with Python 3.11 when raw data is available; optional C7 App/Deal page split.

