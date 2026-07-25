# Foundation hardening audit

## Scope

This branch (`fix/foundation-hardening-g2-grok`) hardens release validation on top of current `origin/main` without changing product behavior, UI flows, or model semantics.

## Problems addressed

1. Permissive `scripts/build_all.py` could skip release-critical outputs without failing in CI.
2. Committed generated reports/exports had no single drift-verification command safe for public checkouts.
3. Data-autopsy outputs could embed machine-local absolute paths.
4. Release gate did not run strict build, generated-output drift, frontend tests, or optional artifact-load checks.

## Changes

- `scripts/build_all.py`: strict mode, output validation, release-critical step registry.
- `scripts/verify_generated_outputs.py`: regenerate public-safe outputs and diff committed artifacts (skips optional private-data steps when inputs are absent).
- `tests/test_build_all.py`: strict/permissive behavior tests.
- `.github/workflows/release-gate.yml`: workspace tests, strict build, conditional artifact load, drift verification.
- `scripts/run_data_autopsy.py`: repository-relative path reporting.
- `AGENTS.md`: authoritative install/validate commands.

## Validation commands

```bash
pnpm install --frozen-lockfile
pnpm check
python -m pytest -q
python scripts/build_all.py --strict
python scripts/verify_generated_outputs.py
node scripts/smoke_public_release.mjs http://127.0.0.1:4010 --api-only
```

## Known limits

- Approved `.pkl` artifacts remain gitignored; CI loads them only when present locally or in a checkout that includes them.
- Optional exports (`market_trend.json`, `halifax_uplift.json`) are drift-checked only when their source inputs exist.

## Readiness

Ready for independent review once the validation commands above pass on the branch SHA under review.
