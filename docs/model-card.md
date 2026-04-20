# Model Card: Vancouver Base Price Model

## Intended Use

Estimate the current listing value of a Vancouver residential property from structured listing features.

This model is meant for portfolio/demo and exploratory planning use. It is not a replacement for an appraisal, broker opinion, or lender valuation.

## Prediction Target

- Target: listing price
- Geography: Vancouver only
- Property types: `Condo`, `Detached`, `Townhouse`, `Duplex`

The current dataset does not contain verified transaction sale prices, so the model should be described as a listing-price model.

## Input Features

User-facing inputs:

- postal code
- property type
- living area in square feet
- bedrooms
- bathrooms
- optional property tax

Engineered features:

- latitude and longitude from postal-code centroids
- postal FSA
- `lat_x_lon`, `lat_sq`, `lon_sq`
- KMeans submarket cluster from Vancouver coordinates

Excluded features:

- listing description text
- raw street names
- parcel-like identifiers
- high-cardinality location strings that could leak identity instead of learning general patterns

## Training Approach

The service trains one model per property type.

For each property type, it compares:

- XGBoost regressor
- Random Forest regressor

The target is transformed with `log(price)` during training, then transformed back to dollars for predictions.

The chosen model family is selected by cross-validation MAE.

## Data Cleaning

The pipeline:

- filters to Vancouver rows
- normalizes property types into the four supported classes
- parses numeric fields from messy listing-style strings
- removes records missing core pricing fields
- removes implausible values for price, square footage, beds, baths, and coordinates
- applies property-type-aware outlier removal using price-per-square-foot and living-area checks
- imputes optional property tax with medians where missing

## Validation

The validation strategy is designed to be understandable and realistic for a small city-specific dataset:

- train/holdout split stratified by price band where possible
- adaptive 3-fold or 5-fold cross-validation depending on sample support
- MAE as the main metric because it is easiest to explain in dollars
- MAPE, RMSE, and R2 as supporting metrics
- bootstrap summaries on holdout predictions
- model-quality payload returned by the API for transparency

## Known Limitations

- The model predicts listing price, not final sale price.
- The dataset is relatively small after filtering to Vancouver and supported property types.
- Property tax is often missing and must be imputed.
- Postal-code centroid features are useful, but they are not as precise as parcel-level geospatial features.
- The model does not know renovation quality, view, floor level, exact building condition, strata rules, or seller motivation.

## Uplift Modeling Status

The renovation uplift layer is not a trained ML model.

Reason:

The current dataset does not contain the labels needed for causal uplift learning. A real uplift model would need property-level examples where the same home has:

```text
pre-renovation state -> renovation event -> resale price within a defined time window
```

Until that dataset exists, the app uses a transparent rule-based calculator for renovation scenarios. This is more honest than training a model on weak proxy labels and presenting it as causal.

## Next Data Science Step

Acquire or license property-level transaction data, then join it with renovation permit and assessment history to create before/after resale labels.

The target for a future uplift model would be:

```text
uplift = post_renovation_sale_price - counterfactual_as_is_value_at_post_sale_date
```

That future model could compare XGBoost and Random Forest again, but the main challenge is label quality, not model choice.
