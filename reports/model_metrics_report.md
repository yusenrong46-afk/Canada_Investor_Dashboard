# Model Metrics Report

Generated from approved pickle artifacts. Temporal metrics are primary when the bundle was trained under Phase E.

## Vancouver base-price model

Valuation basis: **listing price**.

- Primary split: `80/20 stratified by price band within each property type`

| Segment | Model | Temporal MAE | Temporal MAPE | Temporal R2 | N | Random MAE | Random MAPE |
|---|---|---:|---:|---:|---:|---:|---:|
| All supported property types | selected by property type | $323,126 | 12.97% | 0.822 | 704 | not available | not available |
| Condo | xgboost | $147,214 | 11.61% | 0.866 | 397 | not available | not available |
| Detached | xgboost | $745,072 | 17.38% | 0.756 | 200 | not available | not available |
| Duplex | random-forest | $111,447 | 5.86% | 0.878 | 57 | not available | not available |
| Townhouse | xgboost | $273,406 | 14.22% | 0.674 | 50 | not available | not available |

### Conformal coverage

| Segment | Target | Empirical | Calibration N | Coverage N | Waiver |
|---|---:|---:|---:|---:|---|
| Condo | 80.00% | 79.80% | 199 | 198 | none |
| Detached | 80.00% | 81.00% | 100 | 100 | none |
| Duplex | 80.00% | 82.14% | 29 | 28 | none |
| Townhouse | 80.00% | 92.00% | 25 | 25 | none |

### Spatial generalization

| Segment | Random CV MAE | Spatial CV MAE | Gap |
|---|---:|---:|---:|
| Condo | $148,255 | $213,016 | 43.7% |
| Detached | $841,717 | $990,495 | 17.7% |
| Duplex | $146,320 | $196,350 | 34.2% |
| Townhouse | $212,904 | $273,782 | 28.6% |

## Halifax base-price model

Valuation basis: **time-adjusted sale price**.

- Primary split: `temporal holdout: last 6 months of saleDate`
- Secondary random split: `secondary 80/20 stratified by price band per property type`
- Shipped model: `train-only fitted models; conformal intervals cover the shipped models on unseen holdout rows`

| Segment | Model | Temporal MAE | Temporal MAPE | Temporal R2 | N | Random MAE | Random MAPE |
|---|---|---:|---:|---:|---:|---:|---:|
| All supported property types | selected by property type | $80,788 | 14.23% | 0.822 | 1,343 | $71,291 | not available |
| Detached | xgboost | $86,225 | 14.95% | 0.842 | 1,099 | $76,704 | 12.54% |
| Duplex | random-forest | $57,024 | 12.17% | 0.695 | 177 | $47,311 | 10.86% |
| Townhouse | random-forest | $54,388 | 7.92% | 0.825 | 67 | $46,610 | 7.64% |

### Conformal coverage

| Segment | Target | Empirical | Calibration N | Coverage N | Waiver |
|---|---:|---:|---:|---:|---|
| Detached | 80.00% | 80.51% | 550 | 549 | none |
| Duplex | 80.00% | 69.32% | 89 | 88 | Halifax Duplex holdout is thin; empirical conformal coverage may fall below the standard 70% deployment floor. Intervals remain directionally calibrated but are not certified to the usual marginal coverage target for this segment. |
| Townhouse | 80.00% | 75.76% | 34 | 33 | none |

### Spatial generalization

Spatial generalization metrics not available for this artifact.

## Limitations

- Vancouver estimates listing price, not final sale price.
- Halifax estimates time-adjusted sale price; condition and parcel-postal assignment remain imperfect.
- Spatial CV gaps mean neighborhood memorization still matters; treat unseen FSAs cautiously.
- Renovation uplift is a separate workflow and is not causal Vancouver proof.
- Public Vercel deployment uses rules screening, not these fitted pickles.
