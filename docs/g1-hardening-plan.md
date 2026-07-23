# G1 Hardening Plan — execution instructions

Audience: an execution agent (Composer). Follow tasks in order. Do not skip acceptance criteria.
Created: 2026-07-22 from a three-part audit (API server, frontend, Python/DS).

## Ground rules (read first, apply to every task)

1. **Work in this worktree**: `/Users/thomas/Documents/canadian-investor-dashboard-g1-release`, branch `codex/resume-release-g1` (or a child branch `codex/g1-hardening`). NEVER edit `/Users/thomas/Documents/canadian-investor-dashboard` (the dirty main worktree).
2. **Toolchain**: Node 24.14.1 + pnpm 9.15.2 via corepack (`corepack enable`). Python 3.11 with the repo venv for Python tests.
3. **Verification loop after EVERY task** (do not batch tasks without running this):
   ```bash
   pnpm --filter @vvl/shared exec tsc --noEmit -p tsconfig.json
   pnpm --filter @vvl/api-server test
   pnpm --filter @vvl/api-server exec tsc --noEmit
   pnpm --filter @vvl/home-value-planner exec tsc --noEmit -p tsconfig.json
   ```
   For Python tasks add: `python -m pytest tests/ -x -q`.
   Before any deploy-affecting change is declared done, also run the exact Vercel build:
   ```bash
   corepack pnpm --filter @vvl/api-server build:vercel && VITE_DEMO_MODE=false VITE_PUBLIC_MODE=true corepack pnpm --filter @vvl/home-value-planner build
   ```
4. **Non-negotiable product invariants** (from `docs/backend-execution-loop.md`) — a task is WRONG if it violates any:
   - Rules results never claim to be fitted/validated models.
   - Gross appreciation is never presented as net return.
   - Scenario shares are never called probabilities.
   - Missing evidence → abstention or explicit assumption, never invented fallback.
   - Public API responses keep `provenance.contractVersion = "2026-07-18.v1"` semantics (if you must bump the contract, bump the version string AND update `scripts/smoke_public_release.mjs`).
5. **Behavior freeze unless a task says otherwise**: public-mode API numbers (estimate values, uplift %, deal labels) must NOT change in Phases A–D. If a refactor changes any test's expected number, the refactor is wrong — revert and redo.
6. Commit per task with message `hardening(<task-id>): <summary>`. Never `--force` push. Do not commit `.pkl`, `data/raw`, `mlruns`, or `audit/` files.

---

## Phase A — Backend correctness (small, high-value, do first)

### A1. Separate response-contract failures from request validation
- Files: `artifacts/api-server/src/app.ts` (error handler around lines 217–234 and every `*.parse(...)` of an outgoing response at lines ~117, 127, 137, 211).
- Problem: when a *response* fails Zod parsing, the client gets `400 Request validation failed` — a server bug reported as a client error.
- Do:
  1. Create `artifacts/api-server/src/httpErrors.ts` exporting `class ResponseContractError extends Error { constructor(public zodError: ZodError) }`.
  2. Wrap every outgoing-response `schema.parse(payload)` in a helper `parseResponseOrThrow(schema, payload)` that throws `ResponseContractError` on failure.
  3. In the central error handler: `ResponseContractError` → status **500**, body `{ error: { code: "RESPONSE_CONTRACT", message: "Response failed contract validation" } }` and `console.error` the Zod issue list. Request `ZodError` (thrown before handler logic) stays 400.
- Acceptance: new test in `artifacts/api-server/src/routes.test.ts` that stubs a route to return a malformed payload and asserts status 500 + code `RESPONSE_CONTRACT`. All existing tests still pass.

### A2. Unified error envelope + stable error codes
- Files: `artifacts/api-server/src/app.ts` (lines ~96, 195–200, 219–234), frontend `artifacts/home-value-planner/src/api/http.ts`.
- Do:
  1. All API error responses become `{ error: { code, message, issues? } }`. Codes: `VALIDATION` (400), `RATE_LIMITED` (429), `NO_PORTFOLIO` (409), `UPSTREAM_UNAVAILABLE` (502), `UPSTREAM_TIMEOUT` (504), `RESPONSE_CONTRACT` (500), `NOT_FOUND` (404), `INTERNAL` (500).
  2. Keep a legacy top-level `message` field on every error body (frontend and smoke script read it today).
  3. Add a final `app.use` 404 JSON handler with code `NOT_FOUND`.
  4. Update `http.ts` to read `error.code` when present.
- Acceptance: tests asserting envelope shape for 400/404/409/429. `scripts/smoke_public_release.mjs` still passes against a locally compiled public-mode server (`node scripts/smoke_public_release.mjs http://127.0.0.1:<port> --api-only`).

### A3. Model-service timeouts → 504, not generic 500
- File: `artifacts/api-server/src/model.ts` (fetch at lines ~50–57).
- Do: catch `TimeoutError`/`AbortError` from `AbortSignal.timeout` and throw `ModelServiceError("Model service timed out", 504)`. Map to envelope code `UPSTREAM_TIMEOUT`.
- Acceptance: unit test with a mocked fetch that rejects with an `AbortError`, asserting 504.

### A4. Validate query params on `/api/trend` and `/api/map`
- Files: `artifacts/api-server/src/app.ts` (lines ~153–170), `artifacts/shared/src/schemas.ts`.
- Do: add `export const marketQuerySchema = z.object({ market: z.enum(marketValues) })` in shared; parse `req.query` in both routes; invalid market → 400 `VALIDATION` (currently returns 200 "unavailable").
- Also change `artifacts/api-server/src/evidence.ts:13` `propertyType: z.string()` → `z.enum(propertyTypeValues)`.
- Acceptance: tests for `?market=toronto` → 400 on both routes; evidence with bogus propertyType → 400.

### A5. Fix FSA allowlist vs public-profile mismatch
- Files: `artifacts/shared/src/markets.ts` (lines ~5–8), `artifacts/api-server/src/publicEngine.ts` (`fsaProfiles`, lines ~80–109).
- Problem: shared schema accepts `V5C`, `V6A`, `V6X` but the public engine then 400s with "no committed postal-area profile" — validation lies.
- Do (choose exactly this): add profiles for `V5C`, `V6A`, `V6X` to `fsaProfiles` with multipliers interpolated from adjacent FSAs, and note `comparableCount` honestly (copy the pattern of existing entries; pick multipliers between the two geographically nearest existing FSAs). If listing evidence for a multiplier cannot be justified, instead REMOVE those FSAs from `supportedPostalFsasByMarket` so validation matches capability — do not invent precise-looking numbers; prefer removal if unsure.
- Acceptance: for every FSA the shared schema accepts, `POST /api/estimate` in public mode returns 200. Add a test iterating all allowed Vancouver FSAs.

### A6. Require schemas on all JSON file loads; log swallowed errors
- Files: `artifacts/api-server/src/repoFiles.ts:19`, `demo.ts:77–79`, `evidence.ts:43–44`, `map.ts:43–44`, `halifaxUplift.ts:40–41`, `experiments.ts:39–42`, `trend.ts:37–38`.
- Do:
  1. Change `readRepoJson` to return `unknown`; every caller must `schema.parse(...)`.
  2. Add demo-file schemas (reuse response schemas where shapes match) so `demo/sample_*.json` drift fails tests, not runtime.
  3. In every `catch` that currently silently returns `unavailable`, add `console.warn("[api] failed to load <path>", error)` — keep the graceful degradation.
  4. `experiments.ts`: use the Zod parse result, delete the `as ModelExperimentsResponse` cast.
- Acceptance: typecheck passes with `unknown` return; a test that corrupts a temp demo JSON asserts parse failure is thrown at load.

### A7. Rate limiter: fix clear-all bug and trust proxy
- File: `artifacts/api-server/src/app.ts` (lines ~47–98).
- Do:
  1. `app.set("trust proxy", 1)` so `req.ip` is the client IP behind Vercel.
  2. Replace the `if (map.size > 10_000) map.clear()` wipe with pruning only expired entries (iterate and delete entries older than the window).
  3. Log rate-limit denials: `console.warn("[api] rate-limited", req.ip, req.path)`.
  4. Add code comment stating this is per-instance and not a distributed limit (documented limitation; distributed limiting is a G2 item).
- Acceptance: unit test proving that exceeding the limit for IP A does not reset the window for IP B.

### A8. Align the timeout ladder
- Files: `vercel.json` (`maxDuration`), `artifacts/home-value-planner/src/api/http.ts:7`, `artifacts/api-server/src/model.ts:21`.
- Rule to implement: client timeout ≤ server work ≤ platform limit.
- Do: frontend timeout 30s → **9s** for public deployment (`API_TIMEOUT_MS` constant); keep Vercel `maxDuration: 10`; model-service timeout default 60s → **8s** when `PUBLIC_MODE` is irrelevant (live mode only, keep 60s locally via env default but document). Simplest concrete change: `http.ts` timeout constant 9000; add comment referencing `vercel.json maxDuration`.
- Acceptance: grep shows no timeout larger than platform limit on the public path; frontend builds.

### A9. Minimal structured logging + request IDs
- Files: new `artifacts/api-server/src/logging.ts`, wire in `app.ts`.
- Do (no new dependencies):
  1. Middleware: take `x-request-id` header or `crypto.randomUUID()`; set `res.setHeader("x-request-id", id)`; store on `res.locals.requestId`.
  2. On response finish, `console.log(JSON.stringify({ ts, level: "info", requestId, method, path, status, durationMs, mode }))`.
  3. Error handler logs `{ level: "error", requestId, code, message }`.
- Acceptance: test asserting the `x-request-id` response header exists and is echoed when provided.

### A10. Centralize env config
- Files: new `artifacts/api-server/src/config.ts`; update `demo.ts:27`, `publicEngine.ts:29`, `model.ts:20–21`, `index.ts:5–6`, `app.ts:42,47`, `trend.ts`, `marketsRoute.ts`.
- Do: one `config.ts` with a Zod-parsed env object (`DEMO_MODE`, `PUBLIC_MODE`, `MODEL_SERVICE_URL`, `MODEL_SERVICE_TIMEOUT_MS`, `API_CORS_ORIGINS`, `MODEL_REQUESTS_PER_MINUTE`, `API_HOST`, `API_PORT`). Export `getConfig()` that lazily parses once. Invalid numeric env → throw at first access with a clear message. All modules import from here; module-load-time env reads are removed (this fixes the import-order fragility with `api/[...path].js`).
- Acceptance: grep `process.env` in `artifacts/api-server/src` returns matches only inside `config.ts`. All tests pass (tests may need `resetModules` adjustments — keep test env setup working).

---

## Phase B — Backend architecture (refactor, zero behavior change)

### B1. Split `publicEngine.ts` (1022 lines) into modules
- Create `artifacts/api-server/src/public/` with:
  - `vancouverTables.ts` — `typeProfiles`, `fsaProfiles` ONLY, each entry annotated with `dataAsOf` comment.
  - `vancouverEstimate.ts`, `halifaxEstimate.ts`, `publicSimulate.ts`, `publicPlan.ts`, `publicDeal.ts`.
  - `publicEngine.ts` becomes a thin re-export so existing imports/tests don't change.
- HARD RULE: pure code motion. No formula edits. Every existing test must pass with identical expected numbers.
- Acceptance: `wc -l` of every new file < 350; full API suite green with zero test-expectation edits.

### B2. One shared plan builder and one shared deal builder
- Problem: three near-copies — plan logic in `model.ts:133–369` vs `publicEngine.ts:726–897`; deal arithmetic + the `× 1.08` target markup in `dealAnalysis.ts:235–287`, `publicEngine.ts:916–1021`, `demo.ts:364–435`.
- Do:
  1. Create `artifacts/api-server/src/planBuilder.ts`: `buildPlan({ estimate, simulate, catalog, budget, timelineMonths, targetPrice })` where `simulate` is an injected async adapter. Port the PUBLIC implementation's semantics as canonical; adapt live mode to call it with the live simulate adapter.
  2. Create `artifacts/api-server/src/dealBuilder.ts` similarly, and move `computeDealRobustness` into `dealRobustness.ts` with zero engine imports.
  3. Extract shared constants into `artifacts/shared/src/dealPolicy.ts`: `TARGET_MARKUP = 1.08`, `ROBUSTNESS_DRAWS = 5000`, wide-confidence ratio (resolve the current 0.16 live vs 0.17 public divergence: use **0.16** everywhere and update the public test expectation — this is the ONE permitted number change in Phase B; document it in the commit message).
  4. Delete the hardcoded `{ savedTrainingRows: 3_518 }` at `publicEngine.ts:717` — read it from the experiments/metrics export, or omit the field if unavailable.
- Acceptance: `rg "1.08" artifacts/api-server/src` matches only `dealPolicy.ts`. Demo, public, and live deal tests pass. Plan/deal outputs byte-identical for public mode except where 0.17→0.16 documented.

### B3. Mode dispatch table
- File: `artifacts/api-server/src/app.ts` (lines ~112–215).
- Do: replace the repeated ternary `demo ? … : public ? … : live` with a `handlers = resolveHandlers(mode)` object built once per request: `{ estimate, simulate, plan, deal, insights }`. Route bodies call `handlers.estimate(input)`.
- Acceptance: no behavioral change; route tests green; adding a hypothetical new mode requires touching one factory only (assert via code review comment in PR description).

### B4. Test the gaps
- Add to `artifacts/api-server/src`:
  1. HTTP-level tests (supertest style, as `routes.test.ts` does) for `POST /api/estimate|simulate|plan|deal/analyze` in **public** mode — assert status, provenance block, envelope on invalid body.
  2. `buildSalePlan`/`planBuilder` tests: budget exhausted, zero-uplift candidate skipped, notes emitted on overflow.
  3. `requestModelService` failure tests: non-OK status, invalid JSON body, schema-mismatch payload, timeout (mock fetch).
  4. Loosen brittle golden tests: in `publicEngine.halifax.test.ts:151–169` and `routes.test.ts:143`, keep ONE golden number test per market (documented as canary) and convert the rest to invariant assertions (band ordering `low ≤ base ≤ high`, monotonicity in sqft).
- Acceptance: `pnpm --filter @vvl/api-server test` reports ≥ 125 tests, all green.

---

## Phase C — Frontend data layer & truthfulness (user-visible correctness)

### C1. Kill stale-result bugs (the worst UX defect)
- Files: `artifacts/home-value-planner/src/App.tsx` (~172–190), `pages/ImproveValuePage.tsx` (~50–77, 124–170), `pages/PlanPage.tsx` (~105–134, 256–343), `pages/EstimatePage.tsx` (~96–127), `pages/DealAnalyzerPage.tsx` (~216–222).
- Problem: Estimate/Improve/Plan keep showing the PREVIOUS result while a new request is in flight; changing inputs can display numbers that don't match the shown inputs. Deal clears results but then renders charts against `?? 0`.
- Do — implement one policy everywhere:
  1. Compute `requestKey = JSON.stringify(inputsUsedForFetch)` and store it with each result.
  2. Render results ONLY when `result.requestKey === currentKey`. Otherwise render a skeleton/`Updating…` state (create `components/ResultSkeleton.tsx`).
  3. Deal chart: do not render the bar chart until `result` exists — no `?? 0` placeholder bars.
  4. Add `aria-busy={loading}` on result containers.
- Acceptance: manual check with throttled network (change sqft on Estimate → old value must disappear immediately); typecheck green. Add a small unit test for the `requestKey` helper in `lib/`.

### C2. Render provenance on every result surface
- Files: new `components/ProvenanceBadge.tsx`; use in `EstimatePage`, `ImproveValuePage`, `PlanPage`, `DealAnalyzerPage`, `MarketEvidencePanel`.
- Do: badge shows `engineType` (`rules` → "Rules-based screen", `fitted-model` → "Fitted model", `composite` → "Composite"), `evidenceLevel`, `validationStatus`, and an expandable list of `provenance.limitations`. Place directly under each hero metric. The backend already sends all of this; the UI currently drops it — this is the single biggest truthfulness gap.
- Acceptance: every page that shows a CAD figure shows the badge; screenshot each page.

### C3. Validate everything crossing a boundary
- Files: `src/api/http.ts`, `src/api/client.ts`, `src/hooks/useLocalStorageState.ts` (lines 14–23), `src/lib/scenarios.ts` (~241–250).
- Do:
  1. `client.ts`: parse each response with the schemas from `@vvl/shared` `responseSchemas.ts` (`safeParse`; on failure throw an error the page renders as "Response failed contract" banner).
  2. `useLocalStorageState`: accept an optional Zod schema; on parse failure, clear the key and fall back to `initialValue`. Wrap `setItem` in try/catch (quota errors → console.warn, keep app alive).
  3. Scenario store: persist as `{ version: 1, data: ScenarioRecord[] }`; on load, migrate legacy bare-array format; drop records that fail schema; save `provenance.contractVersion` on each new scenario.
  4. Replace `Date.now()+Math.random()` IDs with `crypto.randomUUID()` in `scenarios.ts:53–54`.
- Acceptance: seed localStorage with garbage and with a legacy array in a browser test — app loads, storage is healed. Typecheck green.

### C4. Fix `http.ts` defects + AbortController
- File: `src/api/http.ts` (lines 1–32).
- Do:
  1. Merge `headers` AFTER spreading `init` so callers can't clobber `Content-Type`.
  2. Distinguish JSON-parse failure of an error body from a real error: if `JSON.parse` throws, fall back to `bodyText` for the message.
  3. Accept an optional `signal`; every page effect creates an `AbortController`, passes `controller.signal`, and calls `controller.abort()` in cleanup. Combine with the 9s timeout via `AbortSignal.any([controller.signal, AbortSignal.timeout(9000)])`.
  4. Debounce deal/plan POSTs from committed number edits by 400ms (`lib/useDebouncedValue.ts`).
- Acceptance: rapid input changes produce aborted requests in the network tab, not a pileup; typecheck green.

### C5. Deduplicate UI primitives
- Do:
  1. `components/InlineAlert.tsx` (`tone: "warning" | "error" | "info"`, `role="alert"` for errors) — replace the ~10 hand-rolled banner divs (Estimate/Improve/Plan/Deal/Map/Insights/SiteLayout).
  2. `lib/numberDraft.ts` — extract the duplicated `updateNumberDraft` logic from `DealAnalyzerPage.tsx:110–133` and `PlanPage.tsx:37–60`; on out-of-range commit show an inline field error instead of silently reverting.
  3. `lib/dataSources.ts` — the `dataSourceLabels`/`shortDataPath` maps duplicated in `ImproveValuePage.tsx:21–31` and `PlanPage.tsx:25–35`.
  4. `components/HalifaxUpliftCaveat.tsx` — the caveat paragraph triplicated in Improve/Plan/Deal.
  5. `lib/chartTheme.ts` — the hex colors `#e2e8f0 #94a3b8 #0d9488 #0f766e` repeated across 4 chart files.
- Acceptance: `rg "rounded-card border border-warning" src/pages` → 0 matches; typecheck green; pages visually unchanged.

### C6. Accessibility pass
- Do:
  1. `SiteLayout.tsx:116–179`: add focus trap to the mobile nav dialog (loop Tab within, Escape closes, `inert` on background content).
  2. Add `role="alert"` to error InlineAlerts (done via C5) and `aria-live="polite"` on hero metric containers.
  3. `ScenarioWorkspacePage.tsx:264–269`: `aria-label={"Compare " + scenario.title}` on compare checkboxes.
  4. Market toggle buttons (`PropertyFormCard.tsx:204–225`, `MapPage.tsx:96–108`): `role="radiogroup"` + `aria-checked`.
  5. `MapPage.tsx`: add a keyboard-accessible cell list (a simple `<select>` or listbox of hex cells next to the map that drives the same selection state).
  6. Tailwind `muted` color `#94a3b8` → `#64748b` where used for body-size text (check contrast ≥ 4.5:1).
- Acceptance: keyboard-only walkthrough: open mobile nav, navigate, close; select a map cell; toggle compare boxes. No focus loss.

### C7. Shrink god components (structure only)
- Do, in this order, moving code without changing behavior:
  1. `App.tsx` (288 lines): extract `PropertySessionContext` (property, flags, validation, estimate query) and `useScenarioStore` hook; pages consume context instead of 8–12 drilled props.
  2. `DealAnalyzerPage.tsx` (495): extract `useDealAnalyzeQuery`, `DealInputsForm`, `DealVerdictHero`, `DealRobustnessCard`.
  3. `PlanPage.tsx` (419): extract `usePlanQuery`, `PlanActionList`.
  4. `PropertyFormCard.tsx` (343): extract `usePropertyNumberDrafts`.
- Acceptance: no page file > 300 lines; typecheck green; behavior identical.

### C8. Small truthfulness fixes
- `ScenarioWorkspacePage.tsx:124–130, 312–314`: "Use scenario" routes to `/deal` when `scenario.source === "deal-analyzer"`, else `/plan`.
- `ScenarioWorkspacePage.tsx:102–108`: confirm dialog before "Clear all".
- `ScenarioWorkspacePage.tsx:301–307`: note textarea saves on blur/600ms debounce, not every keystroke.
- `ModelStoryPage.tsx:38–42`: replace hardcoded row counts ("3,518", "17,998", "633") with values from the experiments/metrics API when available; otherwise label them "as of 2026-06 build".
- `ModelTrustSummary.tsx:7–12`: missing `intervalMethod` renders "Not provided", never defaults to "Error-ratio heuristic".
- `MarketEvidencePanel.tsx:63–65`: unavailable evidence renders an explicit "Evidence unavailable" InlineAlert instead of `null`.
- Acceptance: each item verified in browser; typecheck green.

---

## Phase D — Python/DS engineering (no methodology changes yet)

### D1. Pin the environment
- Files: `requirements.txt`, new `requirements.lock.txt`, new `.python-version`.
- Do: pin exact versions of the current working env (`pip freeze` filtered to actual deps); `.python-version` = `3.11`; `scripts/train_model_bundles.py` asserts `sys.version_info[:2] == (3, 11)` and warns if `PYTHONHASHSEED` unset. Move `sentence-transformers`, `dash`, `plotly` to `requirements-analytics.txt` (not needed by the model service).
- Acceptance: fresh venv from lock file runs `python -m pytest tests/ -q` green.

### D2. Artifact manifest + checksums
- Files: new `artifacts/model-service/models/MANIFEST.json`, `common/artifact_loader.py`, `scripts/train_model_bundles.py`.
- Do:
  1. Manifest entries: `{ filename, sha256, sizeBytes, modelVersion, trainedAt, pythonVersion, sklearnVersion, xgboostVersion | null, status: "approved" }`.
  2. Training writes/updates the manifest. `load_approved_pickle` verifies sha256 BEFORE unpickling and refuses on mismatch with a clear `ModelArtifactError`.
  3. Extend `_bundle_validation_issues` (both `base_model/core.py:965–975` and `halifax_model/core.py:828–838`) to require: feature-name list present, holdout row count ≥ a floor, conformal `empiricalCoverage ≥ 0.7`, and sklearn version matching the manifest.
  4. `scripts/generate_model_report.py:48–49`: use `load_approved_pickle` instead of raw `pickle.load`.
- Acceptance: tampering 1 byte of a pkl makes loading fail with the checksum message; tests green.

### D3. Flask service hardening
- Files: `artifacts/model-service/routes.py`, `app.py`.
- Do:
  1. `/health` returns **503** when any required market's `ok` is false; wrap the Vancouver `health_payload()` call in try/except (Halifax already is).
  2. Register error handlers: `ModelArtifactError` → 503 `{ error: { code: "ARTIFACT_UNAVAILABLE", message } }`; generic `Exception` → 500 JSON (log traceback, never leak it).
  3. `get_json(silent=True) or {}` → if content-type is JSON and body unparseable, return 400 `{ error: { code: "INVALID_JSON" } }`.
  4. `_is_halifax_postal` (`routes.py:14–15`): reuse the same Halifax prefix pattern/allowlist the models use instead of `startswith("B")`.
  5. Add input upper bounds mirroring training gates (bedrooms ≤ 12, bathrooms ≤ 12, sqft 100–20000, price fields ≤ 25_000_000) → 400 on violation.
  6. Slim `/health` payload: `ok`, versions, row counts only; move full evaluation summaries to `/metrics`.
  7. Add `gunicorn` to requirements and document the production entrypoint in `docs/deployment.md`: `gunicorn -w 1 --timeout 60 app:app`.
- Acceptance: new `tests/test_flask_routes.py` using Flask test client: health 200/503 paths, invalid JSON 400, Halifax routing by postal, artifact-missing 503.

### D4. Test the real gaps
- Do:
  1. Golden prediction test: commit a tiny fixture bundle (train on a 200-row synthetic CSV inside the test, save, reload) and assert exact prediction values — proves load/predict round-trip stability under pinned deps.
  2. Unit test `match_permits_to_dwellings` 30m BallTree join with synthetic lat/lon: a point at 29m matches, at 31m does not.
  3. Conformal coverage regression: from a fixed synthetic holdout, assert empirical coverage within ±5pp of target.
- Acceptance: `python -m pytest tests/ -q` green, new tests included, runtime < 3 min.

### D5. Pipeline gates that actually gate
- Files: `scripts/build_property_warehouse.py` (~125–190, 338–343), `scripts/setup_halifax_data.py`.
- Do:
  1. Add `--strict` flag (default ON in CI): any `critical` quality check failure → `sys.exit(1)`; FSA completeness and time-adjustment guardrail become `critical` for Halifax.
  2. Sale→dwelling join rate below 0.90 → hard fail with the measured rate in the message.
  3. Rows with null FSA (postal join > 150m) are excluded from model-ready extracts (currently trainable).
  4. Every silent skip ("missing extract → Vancouver-only warehouse") prints a WARNING and, under `--strict`, fails.
- Acceptance: unit test invoking the gate function with a failing metric asserts non-zero exit under strict.

---

## Phase E — DS methodology (changes model numbers; run LAST, retrain + regenerate reports)

Each E task requires retraining (`python scripts/train_model_bundles.py --component all`), regenerating `scripts/generate_model_report.py`, and updating `docs/model-card.md` with new metrics. Do E1–E3 as ONE retraining batch. These artifacts only affect local live mode — production (public rules) is untouched.

### E1. Remove evaluation leakage
- Files: `artifacts/model-service/base_model/core.py`, `halifax_model/core.py`.
- Do:
  1. KMeans (`base:378–381,479`; `halifax:238–241,296`): fit on the training split only; transform holdout. (Restructure: split first, then engineer location features with a fitted transformer.)
  2. Outlier removal (`base:326–343,471–473`): compute IQR thresholds on train only; apply to train; do NOT drop holdout rows (report holdout metrics on all holdout rows).
  3. Imputation (`halifax:292–293`): medians computed from train only.
  4. Split (`base:681–686`, `halifax:546–551`): switch to temporal holdout — last 6 months of `saleDate`/`listingDate` as test; keep the random split as a secondary reported metric.
- Acceptance: retrained bundles load; model report shows both temporal and random metrics; document the (expectedly worse, honest) temporal MAE in the model card.

### E2. Honest conformal for the shipped model
- Problem: conformal is calibrated on a train-only model, then the shipped model is refit on ALL data (`base:762–768`, `halifax:626–632`) — the coverage guarantee doesn't transfer.
- Do (minimal honest fix): ship the **train-only fitted model** (the one the calibration actually covers) instead of the full-data refit. Delete the refit step. Note in the model card that training uses the pre-holdout window only.
- Acceptance: `uncertainty.empiricalCoverage` in responses is measured on data the shipped model never saw; report regenerated.

### E3. Shrink the Halifax bundle
- `halifax_model/core.py:519` (and `base:654`): replace stored full `pricesSorted` arrays with 101 percentile values (P0–P100). Update the percentile-rank lookup to interpolate over those.
- Acceptance: Halifax bundle < 10MB; percentile-rank outputs within 1pp of previous behavior on a fixture.

### E4. Uplift honesty upgrades (labels, not new science)
- Files: `artifacts/model-service/halifax_uplift/core.py:178–184`, `uplift_model/core.py`, `docs/data-dictionary.md:46`.
- Do:
  1. Rename the served p25/p75 fields from confidence-like names to `treatedQuantileRange` (update `artifacts/shared` types + response schemas + UI labels: "spread of observed outcomes, not estimation error").
  2. Data dictionary: fix "Vancouver only this milestone" — the Halifax path exists.
  3. Seattle uplift responses: add limitation string "Transferred from Seattle/King County observations; no Vancouver transportability validation" (Express already labels `proxy` — put the same words in `limitations`).
  4. If both Renovation and Addition categories are ready, do NOT sum them by default — serve the single dominant category and note co-occurrence is unvalidated (`halifax_uplift/core.py:133–135`).
- Acceptance: API/TS/Python tests updated and green; smoke script vocabulary checks still pass.

---

## Execution order & gating

| Order | Phase | Risk | Gate before next |
|---|---|---|---|
| 1 | A (A1–A10) | Low | Full JS suite + local public smoke |
| 2 | B (B1–B4) | Med (refactor) | Suite green with unchanged numbers (except documented 0.17→0.16) |
| 3 | C (C1–C8) | Med (UI) | Typecheck + Vercel build + manual page walkthrough |
| 4 | D (D1–D5) | Low | Python suite green |
| 5 | E (E1–E4) | High (numbers change) | Retrain, regenerate reports, update model card, full suites |

After phases A–C: deploy a Preview, run `node scripts/smoke_public_release.mjs <preview-url>` (expect 9/9), then promote — same procedure as the 2026-07-22 release. Phases D–E do not require a production deploy (live mode is local-only) but must land green in CI.

## Explicitly OUT of scope (do not do)
- Postgres/auth/persistence (G2), cost-complete deal engine (G3).
- Deploying the Python service to production.
- New markets, LLM features, dark mode.
- Rewriting the public pricing tables' values (only their location/format).
