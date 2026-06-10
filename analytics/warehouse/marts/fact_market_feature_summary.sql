-- FSA-level feature summary for analytics, model diagnostics, and dashboard evidence panels.

CREATE OR REPLACE TABLE fact_market_feature_summary AS
SELECT
  market_id,
  city_name,
  province_state,
  property_type,
  postal_fsa,
  COUNT(*) AS training_rows,
  SUM(CASE WHEN is_model_ready THEN 1 ELSE 0 END) AS model_ready_rows,
  ROUND(median(target_value), 2) AS median_target_value,
  ROUND(avg(target_value), 2) AS avg_target_value,
  ROUND(median(price_per_sqft), 2) AS median_price_per_sqft,
  ROUND(avg(living_area_sqft), 2) AS avg_living_area_sqft,
  ROUND(avg(bedrooms), 2) AS avg_bedrooms,
  ROUND(avg(bathrooms), 2) AS avg_bathrooms,
  ROUND(avg(property_tax), 2) AS avg_property_tax
FROM fact_property_training_mart
GROUP BY
  market_id,
  city_name,
  province_state,
  property_type,
  postal_fsa;
