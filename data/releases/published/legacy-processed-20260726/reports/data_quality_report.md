# Data Quality Report

Source inspected: `data/processed/vancouver_base_model_training.csv`

## Dataset Shape

| Check | Result |
|---|---:|
| row count | 3,518 |
| column count | 16 |
| duplicate rows | 7 |

## Missing Values By Key Column

| Column | Missing values |
|---|---:|
| price | 0 (0.00%) |
| propertyType | 0 (0.00%) |
| postalCode | 0 (0.00%) |
| livingAreaSqft | 0 (0.00%) |
| bedrooms | 0 (0.00%) |
| bathrooms | 0 (0.00%) |

## Simple Outlier Checks

| Column | Result |
|---|---:|
| price | 33 outside 100,000 to 10,000,000 |
| livingAreaSqft | 0 outside 250 to 10,000 |
| bedrooms | 0 outside 0 to 10 |
| bathrooms | 0 outside 0 to 10 |

## Notes

- All key columns for the current listing-price workflow were found.
- These checks are simple sanity checks, not a complete production data contract.
- The target is listing price, so this report should not be described as sale-price validation.
