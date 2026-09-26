# Halifax (HRM) Data Recon

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

## Join quality

These figures were **not recomputed** for this milestone. The raw PVSC and HRM snapshots are not in the repository, so none of the percentages below is a new measurement.

The committed processed summary (`data/processed/halifax_base_model_summary.json`) stores:

| Field | Stored value | What it is |
|---|---:|---|
| `rows.windowSales` | 25,160 | Name in the summary. Current code writes this as the count of latest-sale-per-`aan` rows on or after the training window. |
| `rows.joinedToDwellings` | 18,268 | Name in the summary. Current code writes this **after** dropping joined rows that lack coordinates or a time-adjustment factor. |
| `rates.saleToDwellingJoin` | 0.7715 | Stored rate. |
| 18268 / 25160 | 0.726073 | Quotient of the two stored counts, about 72.61%. It is not 0.7715. |

Current code computes the rate on the inner join **before** the coordinate filter and can therefore disagree with `joinedToDwellings` if that later filter removes rows. The stored July summary was not recomputed from raw bytes, because those bytes were not in the repository. The acceptance threshold stays **0.90**. The legacy release is retained and is not a validated release.

A new open-data snapshot was acquired on 2026-09-25 (not a recovery of the July extract). On that snapshot the same denominator — latest sale per `aan` on or after 2022-01-01 — had 26,698 accounts, of which 20,565 matched an eligible dwelling. The measured rate is 0.770282. It is below 0.90, so no HRM data candidate was published. Joined rows per account max was 1. Sale identity is `aan|sale_date|sale_price` because the published sales schema has no `sale_transaction_id`; cross-snapshot matching is unsupported.

The 6,133 unmatched denominator accounts are a partition, measured with `classify_unmatched_sale_accounts` on that snapshot:

| Reason | Accounts |
|---|---:|
| No dwelling row for the account | 2,760 |
| Dwelling passes construction and living-units filters; style is unmapped | 3,017 |
| Every dwelling row is under construction | 268 |
| Living units fall outside 1–4 | 88 |
| Eligible dwelling row existed and still failed to join | 0 |

Of the 3,017 style-unmapped accounts, 2,785 have a null style and 232 are `Manufactured Home`. Both account columns are integers, and zero-padding both sides to 8 digits changes the match count by 0, so this is not a leading-zero join bug. Accounts with no dwelling row are spread across 2022–2026 (491 of them are after the dwelling file's source update on 2026-01-12). Their median sale price is $175,000, against $551,000 for matched accounts.

The highest rate available without inventing a dwelling row is (26,698 − 2,760) / 26,698 = 0.896622, still below 0.90. Eligibility rules and the denominator were left as they are. The acceptance threshold remains 0.90.

On 2026-09-26 the Parcel Sales History view (`6a95-ppg4`) was read again. Its columns are still `municipal_unit`, `aan`, the address fields, `sale_price`, `sale_date`, `parcels_in_sale`, `y_coord`, `x_coord`, and `location`. There is still no `sale_transaction_id`. Socrata `:id` remains a snapshot row id and is not treated as a durable transaction id.

The same day, the ArcGIS FeatureServer layer documents supplied `editingInfo.dataLastEditDate` for the two layers whose source-update time had been unknown. Civic addresses: 2026-09-25T09:41:32.744Z. Geolocated permits: 2026-09-25T09:15:22.596Z. On both layers that instant equals `schemaLastEditDate`, so it is the layer document's edit time, not a per-row observation time. `scripts/setup_halifax_data.py --record-arcgis-source-updates` writes those values onto an existing acquisition manifest and leaves the field empty when the layer document has no `dataLastEditDate`.

Earlier notes that were also not recomputed:

- Joined rows with a 2026 assessed value: **100%** (summary `assessedValuePresent` is 1.0 on the cleaned extract).
- Field completeness on joined sale rows: living area 88.4%, bedrooms 88.6%, bathrooms 100%, year_built 96.1%, coordinates 86.1%.
- Civic addresses: postal code present **95.3%** (100% valid `B#A#A#` format among present), coordinates 100%, **37 distinct FSAs** in HRM.
- An older recon line said the sale-to-dwelling join was **93.2%**. That number is not the stored 0.7715 rate and was not remeasured.

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
