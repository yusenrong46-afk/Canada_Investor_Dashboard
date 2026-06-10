# Halifax / Maritimes Data Recon

Date: 2026-06-09. This document records what open data actually exists for the Halifax expansion, what was downloaded, join quality, and the modelling decisions that follow from it.

## Sources verified and downloaded

| Dataset | Portal | Rows (HRM extract) | Key fields | Licence |
|---|---|---:|---|---|
| Residential Dwelling Characteristics | PVSC datazONE (`a859-xvcs`) | 136,422 | aan, year_built, square_foot_living_area, style, bedrooms, bathrooms, finished_basement, garage, grade, lat/lon | datazONE open data |
| Parcel Sales History | PVSC datazONE (`6a95-ppg4`) | 80,320 (2015+, single-parcel, >$10k) | aan, sale_price, sale_date, parcels_in_sale, lat/lon | datazONE open data |
| Assessed Value History | PVSC datazONE (`bt58-qu28`) | 344,444 (tax years 2025–2026) | aan, tax_year, assessed_value, taxable_assessed_value | datazONE open data |
| Civic Addresses | HRM Open Data (ArcGIS `CivicAddresses`) | 158,354 | PID, CIV_POSTAL, street, GSA_NAME, lat/lon | Open Government Licence – Halifax |
| Building Permits (geolocated) | HRM Open Data (ArcGIS `PPLC_Permits_Geolocated`) | 15,739 | PID, work type/scope, estimated project value, dates, structure type, lat/lon | Open Government Licence – Halifax |

Download tooling: `scripts/setup_halifax_data.py --download-pvsc --download-hrm` (paged Socrata/ArcGIS fetch, files land in `data/raw/halifax/`, gitignored).

## Join quality (measured)

- Sales → dwelling characteristics on `aan`: **93.2%** join rate.
- Joined rows with a 2026 assessed value: **100%**.
- Field completeness on joined sale rows: living area 88.4%, bedrooms 88.6%, bathrooms 100%, year_built 96.1%, coordinates 86.1%.
- Civic addresses: postal code present **95.3%** (100% valid `B#A#A#` format among present), coordinates 100%, **37 distinct FSAs** in HRM.

## Decisions

1. **Target variable: real sale price** (`sale_price` from PVSC Parcel Sales History), not assessment and not listing price. This is *stronger* than the Vancouver market's listing-price target and is labelled `sale-price` in the shared market catalog.
2. **Training window: sales from 2022-01 onward**, time-adjusted to the latest observed month using a monthly median-sale-price index computed from the same HRM sales dataset (single-parcel, ≥$100k market-price filter, 3-month rolling median smoothing, adjustment clipped to [0.5, 2.0]). Target name in the warehouse: `sale_price_time_adjusted`. Rationale: ~4× more training rows than a 12-month window while keeping prices on a current-market basis with a transparent, fully data-derived adjustment.
3. **Property types: Detached, Townhouse, Duplex — no Condo.** PVSC dwelling characteristics covers ground-oriented dwellings; condo apartment units do not appear with usable characteristics. Style mapping: `* Storey` / `Split Entry` / `Split Level` → Detached; `* Townhouse` → Townhouse; `* Semi Detached` / `* Duplex` / `* Triplex` / `* Quadruplex` → Duplex; `Manufactured Home` and data-entry styles (`Additon`) excluded. The API returns a clear error for Condo requests with B-prefix postals.
4. **Postal codes via the HRM civic address layer.** No PVSC or NSCAF dataset carries postal codes. Each property is assigned the postal code of its nearest civic-address point (haversine BallTree, ≤150 m guard); properties without a confident match keep a null FSA and are tracked by a warehouse quality check. The same layer produces the postal/FSA → centroid lookup used at inference time (mirrors the Vancouver bundle's postal-centroid pattern).
5. **Non-market transfers** are filtered with the warehouse model-ready gate (price $100k–$10M) plus the single-parcel and >$10k download filters; the 5th percentile of raw sale prices is $70k, so low-value intra-family transfers exist in the raw file and must not reach training.
6. **Permits are staged, not modelled, this milestone.** The geolocated permits (with PID and estimated project value) are the future Halifax renovation-uplift signal; this milestone stages them in the warehouse only. Uplift remains Seattle-proxy-based.
7. **No invented condos, no proxy postal codes, no fabricated market profiles**: where a field is missing the pipeline keeps it null and the quality checks report it.

## Known limitations to carry into the model card

- Sale prices include market noise (condition at sale unknown; renovations between assessment and sale invisible).
- Time adjustment uses an HRM-wide median index — submarket-level drift differences are not captured.
- Nearest-civic-address postal assignment can misassign at FSA boundaries (≤150 m guard bounds the error).
- Bedrooms missing on ~11% of joined rows (median-imputed at training like Vancouver's age handling, flagged in data quality).
