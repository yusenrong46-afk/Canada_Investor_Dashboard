# Model Card

## Model Name

Vancouver Listing-Price Model

## Intended Use

I use this model to estimate the current listing value of a Vancouver residential property from structured property features.

It is meant for portfolio demonstration, screening, and decision support. It is not an appraisal, lender valuation, or final sale-price prediction.

## Prediction Target

- Target: listing price
- Geography: Vancouver
- Supported property types: `Condo`, `Detached`, `Townhouse`, `Duplex`

I should say listing-price model in interviews. I should not say sale-price model unless I add verified transaction sale data later.

## Inputs

User-facing inputs:

- postal code
- property type
- living area square feet
- bedrooms
- bathrooms
- optional year built
- optional known current value

Engineered inputs:

- postal FSA
- latitude/longitude from postal-code centroids
- coordinate interaction features
- submarket cluster
- derived or imputed age when available

## Training Approach

The service trains separate models by property type. The current workflow compares tree-based models such as Random Forest and XGBoost when the local environment supports them.

The model selection rule is simple: choose the model with the stronger cross-validation MAE for that property type.

## Evaluation

Evaluation is generated through `scripts/generate_model_report.py`.

The report tries to load the saved model artifact and write:

- MAE
- RMSE
- MAPE
- R2
- holdout row count
- selected model family

If the artifact is missing, the report says metrics are not available yet. It does not invent numbers.

## Renovation Uplift Layer

The uplift layer is separate from the base listing-price model.

The current Vancouver dataset does not contain clean before/after renovation resale labels. Because of that, the uplift workflow uses observed repeat-sale / permit-style data as a proxy layer and applies the uplift as a percentage to the Vancouver base estimate.

This is useful for scenario planning, but I would explain it carefully in an interview:

> The uplift model is a decision-support layer, not proof that a specific Vancouver renovation will create that exact value.

## Data Quality

The project includes a data-quality report script:

```bash
.venv/bin/python scripts/generate_data_quality_report.py
```

It checks row count, column count, missing key fields, duplicate rows, and simple outlier ranges for price, area, bedrooms, and bathrooms.

## Known Limitations

- It predicts listing price, not final sale price.
- Local condition details, views, floor level, strata rules, and seller motivation are not captured.
- Some location features are based on postal-code centroids, not parcel-level geometry.
- Renovation uplift needs stronger local Vancouver sale and permit joins.
- Demo mode uses precomputed sample outputs.

## Responsible Use

I would use this dashboard to shortlist deals and explain assumptions. I would not use it alone to make a purchase decision.
