# Model Experiment Lab Report

Generated: 2026-11-09T04:53:47.877267+00:00

Warehouse: `data/warehouse/property_analytics.duckdb`

Model family: `xgboost` (the same family is used by every experiment so the comparison is fair).

## Protocol

- Shared features: living_area_sqft, bedrooms, bathrooms, age_years, latitude, longitude, lat_x_lon, lat_sq, lon_sq (numeric, median-imputed) + postal_fsa, submarket_cluster, property_type (categorical); the pooled and hybrid stages add market_id and province_state.
- Target: `log_target_value`; MAE/MAPE are computed in price space via expm1.
- Primary holdout per market: temporal last 6 months of `sale_date` when dates exist (undated rows excluded); otherwise random 80/20 (random_state 42).
- Secondary metric: random 80/20 holdout MAE/MAPE is noted when the primary split is temporal.
- Spatial check: GroupKFold by postal FSA (n_splits = min(5, FSAs)) on the training split only.
- The hybrid residual stage fits on in-sample pooled residuals; the spatial CV is the out-of-sample check.
- Property-type slices with < 30 holdout rows are skipped, not reported as signal.

## Market Leaderboards (holdout)

### halifax_maritimes — target: sale_price_time_adjusted

| Experiment | Training rows | Holdout rows | MAE | MAPE | Spatial CV MAE |
|---|---:|---:|---:|---:|---:|
| local | 14,627 | 1,021 | $96,364 | 14.8% | $124,323 |
| hybrid | 17,415 | 1,021 | $96,945 | 15.0% | $123,276 |
| pooled | 17,415 | 1,021 | $96,980 | 15.0% | $122,684 |

### vancouver — target: listing_price

| Experiment | Training rows | Holdout rows | MAE | MAPE | Spatial CV MAE |
|---|---:|---:|---:|---:|---:|
| local | 2,788 | 697 | $292,164 | 13.4% | $374,537 |
| hybrid | 17,415 | 697 | $315,359 | 14.8% | $359,341 |
| pooled | 17,415 | 697 | $322,459 | 15.1% | $362,990 |

## Property-Type Slices (holdout)

| Market | Property type | Experiment | Training rows | Holdout rows | MAE | MAPE |
|---|---|---|---:|---:|---:|---:|
| halifax_maritimes | Detached | local | 11,911 | 822 | $105,869 | 15.8% |
| halifax_maritimes | Detached | hybrid | 12,676 | 822 | $106,384 | 16.1% |
| halifax_maritimes | Detached | pooled | 12,676 | 822 | $106,403 | 16.1% |
| halifax_maritimes | Duplex | local | 1,979 | 139 | $53,441 | 11.7% |
| halifax_maritimes | Duplex | hybrid | 2,207 | 139 | $53,756 | 11.8% |
| halifax_maritimes | Duplex | pooled | 2,207 | 139 | $53,802 | 11.8% |
| halifax_maritimes | Townhouse | local | 737 | 60 | $65,576 | 8.2% |
| halifax_maritimes | Townhouse | hybrid | 942 | 60 | $67,680 | 8.4% |
| halifax_maritimes | Townhouse | pooled | 942 | 60 | $67,914 | 8.5% |
| vancouver | Condo | local | 1,590 | 402 | $140,513 | 12.0% |
| vancouver | Condo | hybrid | 1,590 | 402 | $162,577 | 13.7% |
| vancouver | Condo | pooled | 1,590 | 402 | $166,190 | 13.9% |
| vancouver | Detached | local | 765 | 198 | $657,023 | 18.0% |
| vancouver | Detached | hybrid | 12,676 | 198 | $689,817 | 19.1% |
| vancouver | Detached | pooled | 12,676 | 198 | $704,001 | 19.6% |
| vancouver | Duplex | local | 228 | 56 | $139,294 | 7.4% |
| vancouver | Duplex | hybrid | 2,207 | 56 | $154,695 | 8.1% |
| vancouver | Duplex | pooled | 2,207 | 56 | $159,044 | 8.5% |
| vancouver | Townhouse | hybrid | 942 | 41 | $224,464 | 13.6% |
| vancouver | Townhouse | local | 205 | 41 | $225,891 | 13.2% |
| vancouver | Townhouse | pooled | 942 | 41 | $235,282 | 14.4% |

## Skipped Slices

- none

## Conclusions

- Caveat: the two markets have different target semantics (Vancouver models listing price; Halifax/Maritimes models time-adjusted sale price). Pooling tests whether cross-market structure transfers despite that difference, not that the targets are interchangeable.
- halifax_maritimes (target: sale_price_time_adjusted): local wins the holdout with MAE $96,364 (MAPE 14.8%) vs hybrid $96,945, pooled $96,980.
- vancouver (target: listing_price): local wins the holdout with MAE $292,164 (MAPE 13.4%) vs hybrid $315,359, pooled $322,459.
- vancouver Townhouse: hybrid beats the market-level winner local (MAE $224,464 vs $225,891; the local model saw 205 training rows for this slice).
- Spatial generalization on halifax_maritimes (GroupKFold by postal FSA, training split only): pooled has the lowest MAE at $122,684 vs hybrid $123,276, local $124,323.
- Spatial generalization on vancouver (GroupKFold by postal FSA, training split only): hybrid has the lowest MAE at $359,341 vs pooled $362,990, local $374,537.
