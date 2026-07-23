# Halifax uplift design note (Phase 3)

Date: 2026-07-22. Observational renovation evidence — not local causal proof.

## Construct

1. Build consecutive same-`aan` sale pairs (≥180 days, both sales ≥$100k, raw ratio in [0.5, 5]).
2. Time-adjust both prices to the latest HRM monthly median index month.
3. Match HRM permits to PVSC dwellings by nearest point within 30 m.
4. Treat a pair for category C when a non-`New Building` permit of scope C is issued strictly between sales.
5. Controls = pairs with no permit of any scope between sales.
6. Report median treated adjusted ratio − control median; p25/p75 are treated spread around that control median.

## Honesty constraints

- Labels remain **observed / descriptive**. `treatedQuantileRange` is outcome spread, not estimation error.
- **Do not sum** Renovation + Addition (or investor flags that map to both) without co-occurrence validation; serving uses one dominant category.
- Permit→dwelling match is incomplete (~55% in the 2026-07 autopsy). Unmatched permits never enter treated sets → **selection bias**.
- Categories below `minTreatedPairs` (100) stay `insufficient-data` (Addition is currently below).
- Vancouver uplift remains a Seattle proxy unless local sales×permits evidence exists.

## What upgraded in this pass

- Export now carries `permitMatchRate`, `coOccurrenceNote`, and `selectionBiasNote`.
- Method text documents unmatched-permit selection and no-sum co-occurrence policy.
- No change to causal identification strategy — better data joins come before fancier estimators.
