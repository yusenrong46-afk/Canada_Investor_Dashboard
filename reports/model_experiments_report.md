# Model Experiment Lab Report

Generated: 2026-07-26T01:04:51.012198+00:00

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
| local | 14,627 | 1,021 | $96,562 | 14.9% | $124,791 |
| pooled | 17,415 | 1,021 | $97,387 | 15.0% | $122,978 |
| hybrid | 17,415 | 1,021 | $97,484 | 15.0% | $123,589 |

### vancouver — target: listing_price

| Experiment | Training rows | Holdout rows | MAE | MAPE | Spatial CV MAE |
|---|---:|---:|---:|---:|---:|
| local | 2,788 | 697 | $294,568 | 13.4% | $377,622 |
| hybrid | 17,415 | 697 | $316,167 | 14.8% | $361,742 |
| pooled | 17,415 | 697 | $324,267 | 15.1% | $363,326 |

## Property-Type Slices (holdout)

| Market | Property type | Experiment | Training rows | Holdout rows | MAE | MAPE |
|---|---|---|---:|---:|---:|---:|
| halifax_maritimes | Detached | local | 11,911 | 822 | $105,910 | 15.9% |
| halifax_maritimes | Detached | pooled | 12,676 | 822 | $106,844 | 16.0% |
| halifax_maritimes | Detached | hybrid | 12,676 | 822 | $106,955 | 16.1% |
| halifax_maritimes | Duplex | local | 1,979 | 139 | $53,688 | 11.9% |
| halifax_maritimes | Duplex | pooled | 2,207 | 139 | $54,015 | 11.9% |
| halifax_maritimes | Duplex | hybrid | 2,207 | 139 | $54,052 | 11.9% |
| halifax_maritimes | Townhouse | local | 737 | 60 | $67,821 | 8.3% |
| halifax_maritimes | Townhouse | pooled | 942 | 60 | $68,296 | 8.6% |
| halifax_maritimes | Townhouse | hybrid | 942 | 60 | $68,344 | 8.5% |
| vancouver | Condo | local | 1,590 | 402 | $141,115 | 12.0% |
| vancouver | Condo | hybrid | 1,590 | 402 | $164,286 | 13.7% |
| vancouver | Condo | pooled | 1,590 | 402 | $167,128 | 13.9% |
| vancouver | Detached | local | 765 | 198 | $664,825 | 18.2% |
| vancouver | Detached | hybrid | 12,676 | 198 | $691,601 | 19.2% |
| vancouver | Detached | pooled | 12,676 | 198 | $711,032 | 19.7% |
| vancouver | Duplex | local | 228 | 56 | $141,408 | 7.5% |
| vancouver | Duplex | hybrid | 2,207 | 56 | $149,599 | 7.8% |
| vancouver | Duplex | pooled | 2,207 | 56 | $153,483 | 8.1% |
| vancouver | Townhouse | hybrid | 942 | 41 | $219,781 | 13.6% |
| vancouver | Townhouse | local | 205 | 41 | $220,268 | 12.7% |
| vancouver | Townhouse | pooled | 942 | 41 | $230,470 | 14.4% |

## Skipped Slices

- none

## Conclusions

- Caveat: the two markets have different target semantics (Vancouver models listing price; Halifax/Maritimes models time-adjusted sale price). Pooling tests whether cross-market structure transfers despite that difference, not that the targets are interchangeable.
- halifax_maritimes (target: sale_price_time_adjusted): local wins the holdout with MAE $96,562 (MAPE 14.9%) vs pooled $97,387, hybrid $97,484.
- vancouver (target: listing_price): local wins the holdout with MAE $294,568 (MAPE 13.4%) vs hybrid $316,167, pooled $324,267.
- vancouver Townhouse: hybrid beats the market-level winner local (MAE $219,781 vs $220,268; the local model saw 205 training rows for this slice).
- Spatial generalization on halifax_maritimes (GroupKFold by postal FSA, training split only): pooled has the lowest MAE at $122,978 vs hybrid $123,589, local $124,791.
- Spatial generalization on vancouver (GroupKFold by postal FSA, training split only): hybrid has the lowest MAE at $361,742 vs pooled $363,326, local $377,622.
