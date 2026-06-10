# Model Experiment Lab Report

Generated: 2026-06-10T03:18:37.028166+00:00

Warehouse: `/Users/thomas/Documents/canadian-investor-dashboard/data/warehouse/property_analytics.duckdb`

Model family: `xgboost` (the same family is used by every experiment so the comparison is fair).

## Protocol

- Shared features: living_area_sqft, bedrooms, bathrooms, age_years, latitude, longitude, lat_x_lon, lat_sq, lon_sq (numeric, median-imputed) + postal_fsa, submarket_cluster, property_type (categorical); the pooled and hybrid stages add market_id and province_state.
- Target: `log_target_value`; MAE/MAPE are computed in price space via expm1.
- One deterministic 80/20 holdout split per market (random_state 42), reused by every experiment.
- Spatial check: GroupKFold by postal FSA (n_splits = min(5, FSAs)) on the training split only.
- The hybrid residual stage fits on in-sample pooled residuals; the spatial CV is the out-of-sample check.
- Property-type slices with < 30 holdout rows are skipped, not reported as signal.

## Market Leaderboards (holdout)

### halifax_maritimes — target: sale_price_time_adjusted

| Experiment | Training rows | Holdout rows | MAE | MAPE | Spatial CV MAE |
|---|---:|---:|---:|---:|---:|
| pooled | 17,186 | 3,600 | $103,879 | 18.8% | $129,130 |
| hybrid | 17,186 | 3,600 | $103,956 | 18.8% | $129,724 |
| local | 14,398 | 3,600 | $103,985 | 18.6% | $130,655 |

### vancouver — target: listing_price

| Experiment | Training rows | Holdout rows | MAE | MAPE | Spatial CV MAE |
|---|---:|---:|---:|---:|---:|
| local | 2,788 | 697 | $294,568 | 13.4% | $377,622 |
| hybrid | 17,186 | 697 | $313,563 | 14.8% | $365,726 |
| pooled | 17,186 | 697 | $322,212 | 15.1% | $368,303 |

## Property-Type Slices (holdout)

| Market | Property type | Experiment | Training rows | Holdout rows | MAE | MAPE |
|---|---|---|---:|---:|---:|---:|
| halifax_maritimes | Detached | pooled | 12,565 | 2,951 | $114,349 | 20.4% |
| halifax_maritimes | Detached | hybrid | 12,565 | 2,951 | $114,451 | 20.4% |
| halifax_maritimes | Detached | local | 11,800 | 2,951 | $114,475 | 20.2% |
| halifax_maritimes | Duplex | pooled | 2,150 | 479 | $57,627 | 11.9% |
| halifax_maritimes | Duplex | hybrid | 2,150 | 479 | $57,657 | 11.9% |
| halifax_maritimes | Duplex | local | 1,922 | 479 | $58,113 | 12.1% |
| halifax_maritimes | Townhouse | local | 676 | 170 | $51,138 | 9.0% |
| halifax_maritimes | Townhouse | hybrid | 881 | 170 | $52,226 | 9.3% |
| halifax_maritimes | Townhouse | pooled | 881 | 170 | $52,466 | 9.3% |
| vancouver | Condo | local | 1,590 | 402 | $141,115 | 12.0% |
| vancouver | Condo | hybrid | 1,590 | 402 | $165,041 | 13.8% |
| vancouver | Condo | pooled | 1,590 | 402 | $169,432 | 14.1% |
| vancouver | Detached | local | 765 | 198 | $664,825 | 18.2% |
| vancouver | Detached | hybrid | 12,565 | 198 | $678,815 | 18.9% |
| vancouver | Detached | pooled | 12,565 | 198 | $700,503 | 19.6% |
| vancouver | Duplex | local | 228 | 56 | $141,408 | 7.5% |
| vancouver | Duplex | pooled | 2,150 | 56 | $147,062 | 7.5% |
| vancouver | Duplex | hybrid | 2,150 | 56 | $150,582 | 7.7% |
| vancouver | Townhouse | local | 205 | 41 | $220,268 | 12.7% |
| vancouver | Townhouse | hybrid | 881 | 41 | $228,507 | 13.8% |
| vancouver | Townhouse | pooled | 881 | 41 | $232,555 | 14.2% |

## Skipped Slices

- none

## Conclusions

- Caveat: the two markets have different target semantics (Vancouver models listing price; Halifax/Maritimes models time-adjusted sale price). Pooling tests whether cross-market structure transfers despite that difference, not that the targets are interchangeable.
- halifax_maritimes (target: sale_price_time_adjusted): pooled wins the holdout with MAE $103,879 (MAPE 18.8%) vs hybrid $103,956, local $103,985.
- vancouver (target: listing_price): local wins the holdout with MAE $294,568 (MAPE 13.4%) vs hybrid $313,563, pooled $322,212.
- halifax_maritimes Townhouse: local beats the market-level winner pooled (MAE $51,138 vs $52,466; the local model saw 676 training rows for this slice).
- Spatial generalization on halifax_maritimes (GroupKFold by postal FSA, training split only): pooled has the lowest MAE at $129,130 vs hybrid $129,724, local $130,655.
- Spatial generalization on vancouver (GroupKFold by postal FSA, training split only): hybrid has the lowest MAE at $365,726 vs pooled $368,303, local $377,622.
