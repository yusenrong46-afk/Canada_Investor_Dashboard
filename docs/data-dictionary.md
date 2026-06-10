# Data Dictionary

## Core Property Inputs

| Field | Meaning | Notes |
|---|---|---|
| `postalCode` | Canadian postal code | V5/V6 routes to the Vancouver model, B-prefix to Halifax/Maritimes. |
| `propertyType` | Supported home type | Vancouver: `Condo`, `Detached`, `Townhouse`, `Duplex`. Halifax: no `Condo` (PVSC open data covers ground-oriented dwellings only). |
| `livingAreaSqft` | Interior living area | Main size feature. |
| `bedrooms` | Bedroom count | Cleaned as a numeric field. Halifax training imputes missing values (11.7%, flagged). |
| `bathrooms` | Bathroom count | Cleaned as a numeric field. |
| `yearBuilt` | Year built | Optional; used to derive age when available. |
| `knownCurrentValue` | User-provided anchor value | Optional comparison input, not the model target. |

## Model Features

| Field | Meaning | Notes |
|---|---|---|
| `price` | Model target | Vancouver: listing price. Halifax: real sale price time-adjusted to the latest observed month. |
| `logPrice` | Log-transformed target | Used during model training. |
| `pricePerSqft` | Price divided by living area | Used for sanity checks and market context. |
| `postalFsa` | First three postal-code characters | Location grouping. Halifax FSAs come from the civic-address postal bridge. |
| `latitude` / `longitude` | Property coordinates | Vancouver: postal-centroid approximation. Halifax: PVSC parcel coordinates. |
| `lat_x_lon`, `lat_sq`, `lon_sq` | Engineered coordinate terms | Help models capture location curvature. |
| `submarketCluster` | KMeans location cluster (12) | Fit per market. |
| `h3Cell` | H3 resolution-8 hex cell | Cross-market-comparable location encoding; carried in extracts and the warehouse mart. |
| `ageYears` | Property age | Halifax extract column (96% from PVSC `year_built`); Vancouver derives it at training/inference. |
| `propertyTax` | Property tax when available | Vancouver only (48% missing); Halifax is null. |
| `assessedValue` | Latest PVSC assessed value | Halifax only; context and sanity signal, not the target. |
| `salePrice` / `saleDate` | Raw transaction record | Halifax only; `price = salePrice × timeAdjustmentFactor`. |
| `timeAdjustmentFactor` | HRM monthly median-index adjustment | Clipped to [0.5, 2.0]; baseline month in `halifax_base_model_summary.json`. |
| `bedroomsImputed` | Imputation flag | Halifax only. |

## API Outputs

| Field | Meaning | Notes |
|---|---|---|
| `baseValue` | Estimated value | Listing value (Vancouver) or time-adjusted sale value (Halifax). |
| `confidenceLow` / `confidenceHigh` | Calibrated planning range | Live mode: 80%-target split conformal interval. Public/demo: heuristic error-ratio band. |
| `uncertainty` | Interval metadata | `method` (`conformal` / `error-ratio`), `targetCoverage`, measured `empiricalCoverage`, `calibrationNote`. |
| `market` / `marketLabel` | Serving market | `vancouver` / `halifax_maritimes`. |
| `pricePerSqft` | Estimated value per square foot | Used in market checks. |
| `drivers` | Estimate driver list | Live mode: SHAP attributions (log-space, converted to dollars). Each driver carries `source: shap\|heuristic`. |
| `explanationMethod` | How drivers were computed | `shap` or `heuristic`. |
| `marketContext` | Local market summary | Includes `cityMedianValue` / `cityMedianPricePerSqft` (the `vancouverMedian*` keys are deprecated aliases), local median, ceiling, comparable count. |
| `upliftValue` | Estimated added value from improvements | Seattle-proxy layer; Vancouver only this milestone. |
| `finalValueGuardrailed` | After-improvement value with ceiling guardrail | Avoids overstating value above local context. |
| `targetAssessment` | Plan feasibility label | `Likely`, `Stretch`, or `Unlikely`. |
| `riskFlags` | Deal risk notes | Designed for stakeholder communication. |
| `robustness` | Monte Carlo deal stress test | 5,000 seeded triangular draws over the confidence band: `probPositiveUpside`, `probTargetAchievable`, `upsideP10/P50/P90`. A transparency tool, not a market simulation. |

## Committed Data Exports

| File | Purpose |
|---|---|
| `data/exports/market_evidence.json` | Warehouse-backed FSA × property-type evidence (training rows, medians, $/sqft) with provenance; serves `/api/evidence` in every mode. |
| `data/exports/market_trend.json` | StatCan NHPI history + 12-month ETS forecast with 80% intervals and backtest MAPE per market; serves `/api/trend` and Flask `/trend`. |
| `data/exports/market_map.json` | H3 resolution-8 cell aggregates (boundaries, observation rows, median value and $/sqft) per market; cells under 5 observations excluded; serves `/api/map` and the Market map page. |
| `data/exports/halifax_uplift.json` | Observed HRM renovation uplift: repeat-sale pairs (PVSC) joined to geolocated permits, time-adjusted excess uplift by category with treated/control counts; categories below 100 treated pairs are `insufficient-data`. Serves the Flask Halifax `/uplift` path and public mode. |
| `data/exports/model_experiments.json` | Local vs pooled vs hybrid model leaderboard from the shared mart (MAE/MAPE per market and slice, spatial CV, derived conclusions); serves `/api/experiments` and the Model page lab section. |
| `data/processed/vancouver_base_model_training.csv` | Demo-safe Vancouver training extract. |
| `data/processed/halifax_base_model_training.csv` | Demo-safe Halifax training extract (17,998 rows; see `docs/halifax-data-recon.md`). |
| `data/processed/halifax_base_model_summary.json` | Halifax extract build summary (join rates, imputation rates, baseline month). |

## Demo Files

| File | Purpose |
|---|---|
| `demo/sample_properties.json` | Public sample property inputs. |
| `demo/sample_estimates.json` | Stable demo-safe estimate outputs. |
| `demo/sample_plans.json` | Stable demo-safe plan outputs. |
| `demo/sample_metrics.json` | Sample rows for Market & Investment Insights. |

## Analytics Warehouse Tables

| Table | Purpose |
|---|---|
| `dim_market` | Market metadata for Vancouver, Seattle, and Halifax/Maritimes. |
| `dim_source_dataset` | Source lineage, grain, role, and availability for each dataset (PVSC, HRM, Seattle, processed extracts). |
| `stg_vancouver_listings` | Staging table from the processed Vancouver training CSV. |
| `stg_halifax_properties` | Staging table from the processed Halifax training CSV. |
| `stg_halifax_permits` | Staged HRM geolocated building permits (future local uplift signal). |
| `fact_property_training_mart` | Cross-market model-ready observations (shared shape; per-market insert scripts). |
| `fact_market_feature_summary` | FSA/property-type aggregates for analytics and the dashboard evidence panel. |
| `fact_market_trend` | NHPI index history + forecasts per market. |
| `fact_model_experiments` | Model-lab runs: experiment (local/pooled/hybrid) × market × property-type metrics with run timestamp. |
| `fact_data_quality_checks` | Per-market build checks (rows, readiness, FSA completeness, time-adjustment guardrail). |

## Important Interpretation

Vancouver is a listing-price model; Halifax is a time-adjusted sale-price model. The renovation uplift layer is a scenario-planning layer, not a local causal estimate. Confidence ranges are calibrated planning ranges (marginal coverage), not per-property probability statements.
