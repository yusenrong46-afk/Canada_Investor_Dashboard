# Public Vancouver FSA / type table refresh SOP

Production public mode uses committed tables in `artifacts/api-server/src/public/vancouverTables.ts` (type `$/sqft` profiles and FSA multipliers). These are **screening assumptions**, not live fitted-model outputs.

## When to refresh

- After a warehouse rebuild that materially changes Vancouver FSA medians
- When adding or removing an FSA from `artifacts/shared/src/markets.ts`
- When public estimate goldens drift from intended screening behavior

## Steps

1. Rebuild evidence exports if needed:
   ```bash
   .venv/bin/python scripts/build_property_warehouse.py --strict
   ```
2. Compare FSA medians in `data/exports/market_evidence.json` against current `fsaProfiles` multipliers.
3. Update `vancouverTables.ts` only with justified multipliers / `$/sqft` values.
4. Set or update the `dataAsOf` comment on each changed table block.
5. Keep shared `supportedPostalFsasByMarket.vancouver` aligned with `fsaProfiles` keys (no schema-accepted FSA without a public profile).
6. Run:
   ```bash
   cd artifacts/api-server && npm test
   ```
7. Commit with message `data(public): refresh Vancouver screening tables as of YYYY-MM-DD`.

## Do not

- Invent precise multipliers without an evidence source
- Claim public-mode numbers are fitted-model predictions
- Refresh tables in the same commit as unrelated refactors
