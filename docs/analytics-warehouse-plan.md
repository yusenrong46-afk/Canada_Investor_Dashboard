# Analytics Warehouse And Multi-Market Modelling Plan

## Purpose

This project is moving from a single-market valuation workflow into a database-backed property intelligence platform.

The warehouse layer should support:

- repeatable data ingestion from multiple cities
- transparent data-quality checks
- model-ready feature marts
- city-specific and pooled model comparison
- future dashboard evidence panels
- a stronger resume story for analytics engineering and applied ML roles

## Current Source Status

| Source | Role | Status | Notes |
|---|---|---|---|
| Vancouver processed listing training data | Base valuation model | Available | Current listing-price model training extract. |
| Seattle / King County permits and repeat-sale data | Uplift proxy | Available locally | Supports observed renovation uplift transfer layer. |
| Halifax building permits (HRM geolocated) | Expansion renovation signal | Downloaded + staged | 15,739 permits with PID, work scope, and project value; staged as `stg_halifax_permits`, not yet modelled. |
| PVSC / datazONE assessment and parcel datasets | Expansion base model and context | Downloaded + modelled | Dwelling characteristics, parcel sales history, and assessed values for HRM; see `docs/halifax-data-recon.md`. |
| HRM civic addresses | Postal/FSA bridge | Downloaded | Only open postal-code source for the region; powers the nearest-point postal assignment. |
| StatCan NHPI (table 18-10-0205-01) | Market trend layer | Downloaded + exported | Monthly index per market with a 12-month ETS forecast in `data/exports/market_trend.json`. |

## Warehouse Shape

The first warehouse build creates these tables:

| Table | Purpose |
|---|---|
| `dim_market` | Market metadata for Vancouver, Seattle, and Halifax/Maritimes. |
| `dim_source_dataset` | Source lineage and onboarding status. |
| `stg_vancouver_listings` | Staging table from `data/processed/vancouver_base_model_training.csv`. |
| `stg_halifax_properties` | Staging table from `data/processed/halifax_base_model_training.csv`. |
| `stg_halifax_permits` | Staged HRM geolocated permits (future local uplift signal). |
| `fact_property_training_mart` | Model-ready property observations using a cross-market schema (per-market insert scripts). |
| `fact_market_feature_summary` | FSA/property-type summaries for analytics, diagnostics, and the dashboard evidence panel. |
| `fact_market_trend` | NHPI history and ETS forecasts per market. |
| `fact_data_quality_checks` | Per-market build-time quality checks. |

## Model Comparison Roadmap

The warehouse lets us compare models fairly because each candidate reads the same training mart.

1. Local baseline
   - Train Vancouver only.
   - Later train Halifax/Maritimes only once source data is ready.
   - Use this as the simplest explainable baseline.

2. Pooled multi-market model
   - Combine markets in one model.
   - Add `market_id`, `province_state`, `postal_fsa`, property type, size, room count, and engineered geospatial features.
   - Measures whether shared Canadian property patterns help sparse markets.

3. Hybrid / hierarchical model
   - Shared global property signal plus market-specific adjustments.
   - Best fit for the expansion story because it can borrow strength across related markets.
   - Useful for smaller Halifax property-type or neighbourhood segments.

4. Uplift model benchmark
   - Keep the current Seattle observed uplift path as the baseline.
   - Compare meta-learners or causal forests when treated/control-style labels become available.
   - Report Qini/gain-style metrics where true treatment/control labels exist; otherwise label the result as an observed proxy.

## Feature Ideas

| Feature family | Examples | Why it matters |
|---|---|---|
| Structural | living area, beds, baths, age, property type | Core valuation drivers. |
| Location | postal FSA, lat/lon, H3 cell, submarket cluster | Makes cross-city geography comparable. |
| Permit activity | permit count, project value, status, permit type, completion lag | Helps estimate renovation and redevelopment signals. |
| Assessment context | assessed value, assessment history, land size, dwelling characteristics | Useful for Halifax/Maritimes expansion and tax-risk analytics. |
| Market summary | local median, price per sqft, comparable count | Supports dashboard explanations and guardrails. |
| Text embeddings | permit/listing descriptions | Later-stage improvement for condition, renovation, and neighbourhood signals. |

## Resume Story

Strong version:

> Built a cloud-deployed real estate intelligence platform with a DuckDB analytics warehouse, cross-market feature marts, data-quality validation, valuation models, and renovation-uplift analysis for investor decision support.

More technical version:

> Designed a database-backed multi-market property modelling pipeline using DuckDB, SQL feature marts, model-readiness checks, and experiment-ready training tables; prepared the system to compare local, pooled, and hybrid valuation models across Vancouver, Seattle, and Halifax/Maritimes data.

## Next Build Slice

Completed in the Halifax expansion milestone:

1. ~~Materialize the DuckDB file locally.~~ Done — both markets in `fact_property_training_mart` (3,518 Vancouver + 17,998 Halifax rows).
2. ~~Add Halifax source download/onboarding scripts.~~ Done — `scripts/setup_halifax_data.py` (download + training extract) with measured join quality in `docs/halifax-data-recon.md`.
3. ~~Surface a warehouse-backed evidence panel.~~ Done — `scripts/export_market_evidence.py` → `data/exports/market_evidence.json` → `/api/evidence` → the Estimate page evidence panel.

Completed in the intelligence-lab milestone:

4. ~~Experiment table for local/pooled/hybrid comparisons.~~ Done — `scripts/run_model_experiments.py` → `fact_model_experiments` + `data/exports/model_experiments.json` + Model-page leaderboard. Measured: local wins Vancouver, Halifax is a tie, pooling wins spatial extrapolation on both markets.
5. ~~Join HRM permits to PVSC sales for a local Halifax uplift signal.~~ Done — `scripts/build_halifax_uplift.py`: Renovation +12.1% median excess (131 treated pairs, ready); Addition insufficient at 37 pairs.
6. ~~Map the warehouse.~~ Done — `scripts/export_market_map.py` → 802 H3 cells → `/api/map` → the Market map page.

Still ahead:

1. MLflow tracking layered on `fact_model_experiments`; promote spatial-CV findings into production model selection.
2. Pooled/hierarchical multi-market models in production (the lab shows where they help).
3. OSM amenity/transit proximity features keyed on the mart's H3 cells.
4. Segment Halifax Renovation uplift by permit value as the sample grows.
