# Data Dictionary

## Core Property Inputs

| Field | Meaning | Notes |
|---|---|---|
| `postalCode` | Vancouver postal code | Used for FSA and location context. |
| `propertyType` | Supported home type | `Condo`, `Detached`, `Townhouse`, or `Duplex`. |
| `livingAreaSqft` | Interior living area | Main size feature. |
| `bedrooms` | Bedroom count | Cleaned as a numeric field. |
| `bathrooms` | Bathroom count | Cleaned as a numeric field. |
| `yearBuilt` | Year built | Optional; used to derive age when available. |
| `knownCurrentValue` | User-provided anchor value | Optional comparison input, not the model target. |

## Model Features

| Field | Meaning | Notes |
|---|---|---|
| `price` | Listing price | Base model target. This is not final sale price. |
| `logPrice` | Log-transformed price | Used during model training. |
| `pricePerSqft` | Price divided by living area | Used for sanity checks and market context. |
| `postalFsa` | First three postal-code characters | Useful location grouping. |
| `latitude` | Postal-code centroid latitude | Approximate location signal. |
| `longitude` | Postal-code centroid longitude | Approximate location signal. |
| `lat_x_lon` | Coordinate interaction | Simple engineered geospatial feature. |
| `lat_sq` | Latitude squared | Helps tree/linear-style models capture location curve. |
| `lon_sq` | Longitude squared | Helps tree/linear-style models capture location curve. |
| `submarketCluster` | KMeans location cluster | Groups nearby listing patterns. |
| `propertyTax` | Property tax field when available | Has missing values and should be treated carefully. |

## API Outputs

| Field | Meaning | Notes |
|---|---|---|
| `baseValue` | Estimated listing value | Main estimate shown on the Estimate page. |
| `confidenceLow` | Lower confidence range | Planning range, not a guarantee. |
| `confidenceHigh` | Upper confidence range | Planning range, not a guarantee. |
| `pricePerSqft` | Estimated value per square foot | Used in market checks. |
| `drivers` | Estimate driver list | Helps explain why the estimate moved. |
| `marketContext` | Local market summary | Includes local median, ceiling, and comparable count. |
| `upliftValue` | Estimated added value from selected improvements | Demo mode uses sample output. |
| `finalValueGuardrailed` | Estimated after-improvement value with ceiling guardrail | Avoids overstating value above local context. |
| `targetAssessment` | Plan feasibility label | `Likely`, `Stretch`, or `Unlikely`. |
| `riskFlags` | Deal risk notes | Designed for stakeholder communication. |

## Demo Files

| File | Purpose |
|---|---|
| `demo/sample_properties.json` | Public sample property inputs. |
| `demo/sample_estimates.json` | Stable demo-safe estimate outputs. |
| `demo/sample_plans.json` | Stable demo-safe plan outputs. |
| `demo/sample_metrics.json` | Sample rows for Market & Investment Insights. |

## Important Interpretation

I should explain the model as a listing-price model. The current dataset does not prove final sale price, and the renovation uplift layer is a scenario-planning layer, not a local causal estimate.
