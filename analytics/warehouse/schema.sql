-- Analytics warehouse seed tables.
-- The marts are intentionally source-agnostic so Vancouver, Halifax, Seattle, and future cities can share one model-ready contract.

CREATE OR REPLACE TABLE dim_market (
  market_id VARCHAR PRIMARY KEY,
  market_name VARCHAR NOT NULL,
  province_state VARCHAR NOT NULL,
  country VARCHAR NOT NULL,
  source_role VARCHAR NOT NULL,
  model_status VARCHAR NOT NULL,
  notes VARCHAR NOT NULL
);

INSERT INTO dim_market VALUES
  (
    'vancouver',
    'Vancouver',
    'BC',
    'Canada',
    'base valuation market',
    'dataset-backed baseline',
    'Current processed listing-price training data. Needs stronger transaction/sale labels before appraisal-style claims.'
  ),
  (
    'seattle',
    'Seattle / King County',
    'WA',
    'United States',
    'uplift proxy market',
    'repeat-sale uplift proxy',
    'Observed repeat-sale and permit-style data used for renovation uplift transfer learning.'
  ),
  (
    'halifax_maritimes',
    'Halifax / Maritimes',
    'NS/NB/PE',
    'Canada',
    'expansion valuation market',
    'dataset-backed sale-price training',
    'PVSC parcel sales joined to dwelling characteristics with HRM civic-address postal codes. Real sale-price target, time-adjusted to the latest observed month.'
  );

CREATE OR REPLACE TABLE dim_source_dataset (
  source_dataset_id VARCHAR PRIMARY KEY,
  market_id VARCHAR NOT NULL,
  source_name VARCHAR NOT NULL,
  source_path VARCHAR NOT NULL,
  grain VARCHAR NOT NULL,
  target_role VARCHAR NOT NULL,
  availability_status VARCHAR NOT NULL,
  notes VARCHAR NOT NULL
);

INSERT INTO dim_source_dataset VALUES
  (
    'processed_vancouver_listing_training',
    'vancouver',
    'Processed Vancouver listing training data',
    'data/processed/vancouver_base_model_training.csv',
    'property listing observation',
    'base price training',
    'available',
    'Tracked demo-safe training mart extract with listing-price target and engineered geospatial features.'
  ),
  (
    'seattle_building_permits',
    'seattle',
    'Seattle building permits',
    'data/raw/seattle/building_permits.csv',
    'permit record',
    'renovation signal',
    'available locally',
    'Large raw public permit file used by the uplift workflow; not committed for public deployment.'
  ),
  (
    'halifax_building_permits',
    'halifax_maritimes',
    'HRM building permits (geolocated)',
    'data/raw/halifax/hrm_building_permits_geolocated.csv',
    'permit record',
    'renovation signal and expansion feature',
    'available locally',
    'Downloaded from the HRM open data ArcGIS hub with PID, work scope, project value, dates, and coordinates. Staged for the future local uplift signal; not yet modelled.'
  ),
  (
    'pvsc_property_assessment',
    'halifax_maritimes',
    'PVSC / datazONE assessment, dwelling, and parcel-sales datasets',
    'data/raw/halifax/pvsc_*.csv',
    'parcel or assessment account',
    'base price and market context',
    'available locally',
    'Downloaded from PVSC datazONE: assessed value history, residential dwelling characteristics, and parcel sales history for HRM, joined on assessment account number.'
  ),
  (
    'hrm_civic_addresses',
    'halifax_maritimes',
    'HRM civic addresses (postal-code bridge)',
    'data/raw/halifax/hrm_civic_addresses.csv',
    'civic address point',
    'postal and FSA assignment',
    'available locally',
    'Only open postal-code source for the region; each PVSC parcel takes the postal code of its nearest civic-address point within 150 m.'
  ),
  (
    'processed_halifax_training',
    'halifax_maritimes',
    'Processed Halifax training data',
    'data/processed/halifax_base_model_training.csv',
    'property sale observation',
    'base price training',
    'available',
    'Tracked demo-safe training extract with a time-adjusted real sale-price target, engineered geospatial features, and assessment context.'
  );
