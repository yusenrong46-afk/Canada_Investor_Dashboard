# Foundation review checklist

Use this checklist for independent verification. Do not infer pass/fail from narrative text alone.

## Branch and scope

1. Branch name: `fix/foundation-hardening-g2-grok`.
2. Base: current `origin/main`.
3. Confirm diff is foundation-only (build/CI/docs/path hygiene), not product features.

## Runtime compatibility

1. `.python-version` is `3.11`.
2. `python -m pip install -r requirements.txt` and `pip check` succeed.
3. Node 24 + pnpm 9 install with `pnpm install --frozen-lockfile`.

## Required commands

1. `pnpm check`
2. `python -m pytest -q`
3. `python scripts/build_all.py --strict`
4. `python scripts/verify_generated_outputs.py`
5. `pnpm audit --prod --audit-level=high`
6. Public smoke: `node scripts/smoke_public_release.mjs <url> --api-only`

## Mode semantics

1. Public mode uses rules engine and does not claim live fitted models.
2. Demo mode uses fixed sample outputs.
3. Live mode loads approved artifacts via `load_approved_pickle`; missing artifacts fail explicitly.

## Generated outputs

1. No machine-local absolute paths in committed public exports/reports.
2. README warehouse counts match `reports/analytics_warehouse_report.md`.
3. Drift verifier passes on clean checkout policy.

## Security

1. CSP and security headers remain active on API responses.
2. No secrets or private raw data committed.

## Decision

- If any required command fails, mark **NOT READY** with exact reproducer.
- If all pass and scope is clean, mark **READY FOR INDEPENDENT REVIEW**.
