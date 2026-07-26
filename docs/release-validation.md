# Release validation

Tightens build and CI checks without changing product behavior.

## What broke before

1. `build_all.py` could skip important outputs and still exit 0.
2. Committed exports/reports had no drift check that worked on a public clone.
3. Data-autopsy dumps could write machine-local paths into the repo.

## What changed

| File | Change |
|---|---|
| `scripts/build_all.py` | `--strict` mode; validates JSON outputs |
| `scripts/verify_generated_outputs.py` | Regenerates outputs, diffs against git HEAD |
| `tests/test_build_all.py` | Covers strict vs permissive behavior |
| `.github/workflows/release-gate.yml` | Workspace tests, strict build, drift verify |
| `scripts/run_data_autopsy.py` | Repo-relative paths in reports |

Optional steps (`market_trend`, `halifax_uplift`) are skipped when raw inputs aren't in the checkout. Drift check includes them only if the files already exist.

Approved `.pkl` bundles stay gitignored. CI loads them when present; otherwise pytest covers the loader contract.

## Commands to run locally

```bash
pnpm install --frozen-lockfile
pnpm check
python -m pytest -q
python scripts/build_all.py --strict
python scripts/verify_generated_outputs.py
pnpm audit --prod --audit-level=high
node scripts/smoke_public_release.mjs http://127.0.0.1:4010 --api-only
```

## Pre-merge checklist

- [ ] Diff is build/CI/docs only — no surprise product changes
- [ ] Python 3.11 + Node 24 + pnpm 9 install cleanly
- [ ] All commands above pass
- [ ] No absolute home paths in committed exports/reports
- [ ] Public mode still uses rules engine; demo mode still uses fixed samples
- [ ] CSP/security headers untouched
