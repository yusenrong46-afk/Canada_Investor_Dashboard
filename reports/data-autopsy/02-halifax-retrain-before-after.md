# Phase 2 retrain — before / after

Date: 2026-07-22. Halifax only (Vancouver still blocked on empty listing dates).

## Cleaning impact on extract size

| Metric | Before | After |
|---|---:|---:|
| Clean training rows | 17,998 | 17,702 |
| Dropped zero baths | — | 84 |
| Dropped assessed outliers | — | 177 |
| Dropped null postal | 75 | 69 |
| Bedrooms left null | 0 (pre-filled) | 2,054 |
| Max ageYears | 466 | 149 (nulled &gt;150) |
| submarketCluster | 12 baked labels | `unassigned` placeholder |

## Halifax temporal holdout (headline)

| Segment | Before MAE | After MAE | Before MAPE | After MAPE | N before → after |
|---|---:|---:|---:|---:|---:|
| All | $90,161 | **$80,701** | 15.81% | **14.24%** | 1,356 → 1,343 |
| Detached | $97,103 | $86,119 | 16.81% | 14.95% | 1,112 → 1,099 |
| Duplex | $59,948 | $57,024 | 12.45% | 12.17% | 177 → 177 |
| Townhouse | $54,776 | $54,388 | 8.00% | 7.92% | 67 → 67 |

## Honesty notes

- Metrics improved **after removing bad rows / leakage-prone bedroom fills**, not after inventing dates or relaxing protocol.
- Duplex conformal empirical coverage moved **71.6% → 69.3%** (still thin-segment; waiver remains). Honesty preferred over pretending 80%.
- Vancouver bundle unchanged; temporal retrain still fail-closed until dated listings exist.
- Public Vercel rules path unchanged.
