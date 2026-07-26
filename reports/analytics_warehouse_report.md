# Analytics Warehouse Report

Warehouse: `data/warehouse/property_analytics.duckdb`

## Build Summary

| Metric | Value |
|---|---:|
| source rows (all markets) | 21,220 |
| property training mart rows | 21,220 |
| model-ready rows | 19,133 |
| market feature summary rows | 186 |
| halifax_maritimes mart rows | 17,702 |
| vancouver mart rows | 3,518 |
| staged HRM permit rows | 15,739 |

## Data Quality Checks

| Check | Market | Severity | Observed | Threshold | Status |
|---|---|---|---:|---|---|
| source_rows_present | vancouver | critical | 3,518 | > 0 rows | pass |
| model_ready_rows | vancouver | critical | 3,485 | > 0 rows | pass |
| postal_fsa_completeness | vancouver | warning | 100.00% | >= 0.95 | pass |
| property_tax_completeness | vancouver | info | 48.21% | tracked only | pass |
| source_rows_present | halifax_maritimes | critical | 17,702 | > 0 rows | pass |
| model_ready_rows | halifax_maritimes | critical | 15,648 | > 0 rows | pass |
| postal_fsa_completeness | halifax_maritimes | critical | 100.00% | >= 0.95 | pass |
| assessed_value_completeness | halifax_maritimes | info | 100.00% | tracked only | pass |
| time_adjustment_within_guardrail | halifax_maritimes | critical | 100.00% | >= 0.99 | pass |

## Why This Matters

- The project now has a database-backed training mart shape instead of only ad hoc CSV consumption.
- Vancouver (listing-price target) and Halifax/Maritimes (time-adjusted real sale-price target) share one model-ready contract.
- The mart separates source lineage, data readiness, market summaries, and model-ready observations.
- The next modelling step is to compare local Vancouver, local Halifax, pooled, and hybrid models on the same feature contract.
