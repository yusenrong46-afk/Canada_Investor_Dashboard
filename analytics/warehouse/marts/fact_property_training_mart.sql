-- Model-ready property observations shared by every market.
-- Each onboarded market has its own insert script (fact_property_training_mart_insert_<market>.sql)
-- that conforms its staging table to this shape; the build script runs whichever
-- inserts have staging data loaded.

CREATE OR REPLACE TABLE fact_property_training_mart (
  property_observation_id VARCHAR,
  market_id VARCHAR,
  city_name VARCHAR,
  province_state VARCHAR,
  country VARCHAR,
  target_name VARCHAR,
  target_value DOUBLE,
  log_target_value DOUBLE,
  price_per_sqft DOUBLE,
  property_type VARCHAR,
  postal_code VARCHAR,
  postal_fsa VARCHAR,
  submarket_cluster VARCHAR,
  h3_cell VARCHAR,
  living_area_sqft DOUBLE,
  bedrooms DOUBLE,
  bathrooms DOUBLE,
  age_years DOUBLE,
  latitude DOUBLE,
  longitude DOUBLE,
  lat_x_lon DOUBLE,
  lat_sq DOUBLE,
  lon_sq DOUBLE,
  property_tax DOUBLE,
  assessed_value DOUBLE,
  sale_date VARCHAR,
  time_adjustment_factor DOUBLE,
  is_model_ready BOOLEAN,
  source_table VARCHAR,
  data_quality_tier VARCHAR
);
