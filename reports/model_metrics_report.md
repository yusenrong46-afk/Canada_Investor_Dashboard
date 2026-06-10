# Model Metrics Report

## Base Price Model

| Segment | Model | MAE | RMSE | MAPE | R2 | N |
|---|---:|---:|---:|---:|---:|---:|
| All supported property types | selected by property type | $331,348 | $570,615 | 12.64% | 0.821 | 706 |
| Condo | xgboost | $154,848 | $301,192 | 10.83% | 0.869 | 399 |
| Detached | xgboost | $760,003 | $1,261,582 | 17.73% | 0.742 | 200 |
| Duplex | random-forest | $111,444 | $158,389 | 5.86% | 0.878 | 57 |
| Townhouse | xgboost | $275,891 | $426,688 | 14.42% | 0.686 | 50 |

## Model Selection Notes

- Condo: `xgboost` selected by cross-validation MAE.
- Detached: `xgboost` selected by cross-validation MAE.
- Duplex: `random-forest` selected by cross-validation MAE.
- Townhouse: `xgboost` selected by cross-validation MAE.
- The app compares XGBoost and Random Forest per property type when the training artifact is available.

## Conformal Coverage

| Segment | Target coverage | Empirical coverage | Calibration rows | Coverage rows | Interval ratio |
|---|---:|---:|---:|---:|---:|
| Condo | 80.00% | 83.92% | 200 | 199 | 0.1829 |
| Detached | 80.00% | 82.00% | 100 | 100 | 0.3110 |
| Duplex | 80.00% | 78.57% | 29 | 28 | 0.0996 |
| Townhouse | 80.00% | 92.00% | 25 | 25 | 0.3958 |

## Spatial Generalization

| Segment | Random CV MAE | Spatial CV MAE | Gap |
|---|---:|---:|---:|
| Condo | $149,525 | $211,063 | 41.2% |
| Detached | $840,331 | $982,157 | 16.9% |
| Duplex | $146,401 | $197,087 | 34.6% |
| Townhouse | $209,278 | $265,639 | 26.9% |

Spatial CV uses GroupKFold grouped by postal FSA, so each validation fold contains only postal areas the model never saw in training.

## Data Quality Summary

| Check | Result |
|---|---:|
| rows before cleaning | 24,382 |
| Vancouver rows | 3,949 |
| usable rows before outlier removal | 3,599 |
| usable rows after cleaning | 3,518 |
| missing price | 0 (0.00%) |
| missing livingAreaSqft | 45 (1.14%) |
| missing bedrooms | 96 (2.43%) |
| missing bathrooms | 2 (0.05%) |
| missing postalCode | 0 (0.00%) |
| missing propertyType | 236 (5.98%) |

## Limitations

- The base model estimates listing price, not final sale price.
- Renovation uplift is a separate workflow and should not be treated as causal Vancouver sale-price proof.
- If the saved artifact is missing, this report intentionally refuses to invent MAE, RMSE, MAPE, or R2.
- The dashboard is useful for screening and explanation, but it still needs local comparable-sale review.
