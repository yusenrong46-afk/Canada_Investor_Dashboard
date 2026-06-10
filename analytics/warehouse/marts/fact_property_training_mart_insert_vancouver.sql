-- Vancouver listing-price observations from the processed training extract.

INSERT INTO fact_property_training_mart
SELECT
  'vancouver:' || CAST(row_number() OVER () AS VARCHAR) AS property_observation_id,
  'vancouver' AS market_id,
  'Vancouver' AS city_name,
  'BC' AS province_state,
  'Canada' AS country,
  'listing_price' AS target_name,
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
  NULL AS age_years,
  CAST(latitude AS DOUBLE) AS latitude,
  CAST(longitude AS DOUBLE) AS longitude,
  CAST(lat_x_lon AS DOUBLE) AS lat_x_lon,
  CAST(lat_sq AS DOUBLE) AS lat_sq,
  CAST(lon_sq AS DOUBLE) AS lon_sq,
  CAST(propertyTax AS DOUBLE) AS property_tax,
  NULL AS assessed_value,
  NULL AS sale_date,
  NULL AS time_adjustment_factor,
  CASE
    WHEN price BETWEEN 100000 AND 10000000
      AND livingAreaSqft BETWEEN 250 AND 10000
      AND bedrooms BETWEEN 0 AND 10
      AND bathrooms BETWEEN 0 AND 10
      AND propertyType IN ('Condo', 'Detached', 'Townhouse', 'Duplex')
      THEN TRUE
    ELSE FALSE
  END AS is_model_ready,
  'processed_vancouver_listing_training' AS source_table,
  'dataset-backed' AS data_quality_tier
FROM stg_vancouver_listings;
