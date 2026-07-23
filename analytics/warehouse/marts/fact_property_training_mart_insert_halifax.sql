-- Halifax/Maritimes observations from PVSC parcel sales joined to dwelling
-- characteristics. Target is the time-adjusted real sale price; see
-- docs/halifax-data-recon.md for the join and adjustment decisions.

INSERT INTO fact_property_training_mart
SELECT
  'halifax_maritimes:' || CAST(row_number() OVER () AS VARCHAR) AS property_observation_id,
  'halifax_maritimes' AS market_id,
  'Halifax' AS city_name,
  'NS' AS province_state,
  'Canada' AS country,
  'sale_price_time_adjusted' AS target_name,
  CAST(price AS DOUBLE) AS target_value,
  CAST(logPrice AS DOUBLE) AS log_target_value,
  CAST(pricePerSqft AS DOUBLE) AS price_per_sqft,
  CAST(propertyType AS VARCHAR) AS property_type,
  CAST(postalCode AS VARCHAR) AS postal_code,
  CAST(postalFsa AS VARCHAR) AS postal_fsa,
  CAST(submarketCluster AS VARCHAR) AS submarket_cluster,
  CAST(h3Cell AS VARCHAR) AS h3_cell,
  CAST(livingAreaSqft AS DOUBLE) AS living_area_sqft,
  CAST(bedrooms AS DOUBLE) AS bedrooms,
  CAST(bathrooms AS DOUBLE) AS bathrooms,
  CAST(ageYears AS DOUBLE) AS age_years,
  CAST(latitude AS DOUBLE) AS latitude,
  CAST(longitude AS DOUBLE) AS longitude,
  CAST(lat_x_lon AS DOUBLE) AS lat_x_lon,
  CAST(lat_sq AS DOUBLE) AS lat_sq,
  CAST(lon_sq AS DOUBLE) AS lon_sq,
  CAST(propertyTax AS DOUBLE) AS property_tax,
  CAST(assessedValue AS DOUBLE) AS assessed_value,
  CAST(saleDate AS VARCHAR) AS sale_date,
  CAST(timeAdjustmentFactor AS DOUBLE) AS time_adjustment_factor,
  CASE
    WHEN price BETWEEN 100000 AND 10000000
      AND livingAreaSqft BETWEEN 250 AND 10000
      AND bedrooms BETWEEN 0 AND 10
      AND bathrooms BETWEEN 0 AND 10
      AND propertyType IN ('Detached', 'Townhouse', 'Duplex')
      AND postalCode IS NOT NULL
      AND postalFsa IS NOT NULL
      THEN TRUE
    ELSE FALSE
  END AS is_model_ready,
  'processed_halifax_training' AS source_table,
  'dataset-backed' AS data_quality_tier
FROM stg_halifax_properties;
