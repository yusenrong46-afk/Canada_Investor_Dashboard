# Vancouver Uplift Model Dataset Research

Purpose: identify datasets that can support a real second-layer uplift model for Vancouver home-value planning.

Bottom line:

- Public City of Vancouver open data is useful for renovation signals, parcel/address joins, zoning, and assessment proxies.
- A true uplift model requires property-level sales transactions, ideally from BC Assessment or a licensed commercial source.
- Without Vancouver sales transactions, the live workaround is to train observed uplift percentages from Seattle/King County repeat-sale data and apply those percentages to Vancouver estimates.
- The live uplift path should not use generated rows or proxy labels.

## Best Dataset Stack

### 1. Must-have: BC Assessment sales / inventory extract

Source:

- BC Assessment Property Information Services: https://info.bcassessment.ca/services-and-products/Pages/Buy-and-Exchange-Data.aspx
- BC Assessment Data Extracts: https://info.bcassessment.ca/services-and-products/Pages/Custom-data-extracts.aspx
- BC Assessment Monthly Sales Report: https://info.bcassessment.ca/services-and-products/Pages/Monthly-sales-report.aspx
- Academic access: https://info.bcassessment.ca/Services-products/data-for-academic-institutions

Why we need it:

- It is the most important dataset for the uplift model.
- It can provide property-level sales data, inventory/structural attributes, assessment values, and possibly permit-related data.
- The Monthly Sales Report includes recent sales and previous transactions by property, but a custom historical extract is better for building 2017+ uplift labels.

Request Vancouver scope:

- Assessment area: Vancouver, area code 09
- Geography: City of Vancouver only
- Time range: 2017 to current, matching the City permit dataset start year
- Property types: single family/detached, duplex, condo/strata, townhouse/rowhouse
- Data format: CSV or XLSX

Minimum fields to request:

- stable property identifier: folio, roll number, PID, or assessment property identifier
- civic address fields
- postal code
- latitude / longitude if available
- property class / property type
- bedrooms
- bathrooms
- finished living area
- lot size
- year built
- effective year / renovated year if available
- current and historical assessed land value
- current and historical assessed improvement value
- sale date
- sale price
- sale type / transaction validity indicator
- previous sale date and previous sale price
- permit history if available
- inventory snapshot date or assessment year

Exploration questions:

- Can each property be tracked across multiple sales?
- Are sale types clean enough to exclude non-arm's-length transfers?
- Do we get enough resales within 90-365 days after renovation permits?
- Do inventory fields update after renovations, or only annually?
- Can sales be joined to City permits by folio/PID/address reliably?

## 2. Must-have open renovation signal: City of Vancouver issued building permits

Source:

- Dataset page: https://opendata.vancouver.ca/explore/dataset/issued-building-permits/export/
- API console: https://opendata.vancouver.ca/api/explore/v2.1/console

Important source constraint:

- The dataset starts in 2017.
- It is based on permit issuance date.
- It does not show current permit status or later changes after original issuance.
- Therefore v1 should use an issuance-date lag rule unless we can obtain completion/final-inspection data elsewhere.

Useful fields:

- permit number
- permit issue date
- issue year
- permit number created date
- permit elapsed days
- project value
- type of work
- address
- project description
- permit category
- property use
- specific use category
- geo local area
- geo point

Recommended export URL:

```text
https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/issued-building-permits/exports/csv?select=permitnumber%2Cpermitnumbercreateddate%2Cissuedate%2Cissueyear%2Cpermitelapseddays%2Cprojectvalue%2Ctypeofwork%2Caddress%2Cprojectdescription%2Cpermitcategory%2Cpropertyuse%2Cspecificusecategory%2Cgeolocalarea%2Cgeo_point_2d
```

Exploration questions:

- How many records are residential additions/alterations/repairs?
- How many have project value?
- Which permit categories should be excluded as new build, demolition, salvage, or abatement?
- Can we classify permit text into the current high-value uplift flags?
- Can permit address join to BCA sales property identifiers?

## 3. Context only: City of Vancouver property tax report

Source:

- Current segmented dataset: https://opendata.vancouver.ca/explore/dataset/property-tax-report/information
- Historical datasets are segmented since 2006.

Why we need it:

- Gives annual assessed land/improvement value context.
- Useful as context for assessment history, but not as a live proxy label.
- Useful for year built, big improvement year, zoning district, and postal code context.

Useful fields:

- report year
- tax assessment year
- current land value
- current improvement value
- previous land value
- previous improvement value
- tax levy
- year built
- big improvement year
- property postal code
- civic number
- street name
- zoning district

Recommended export URL:

```text
https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-tax-report/exports/csv?select=report_year%2Ctax_assessment_year%2Ccurrent_land_value%2Ccurrent_improvement_value%2Cprevious_land_value%2Cprevious_improvement_value%2Ctax_levy%2Cyear_built%2Cbig_improvement_year%2Cproperty_postal_code%2Cfrom_civic_number%2Cstreet_name%2Czoning_district
```

Exploration questions:

- Can we build annual assessment timelines by address/folio?
- How often does improvement value jump after permits?
- Does `big_improvement_year` align with renovation permits?
- Are missing or duplicated addresses a major join problem?

## 4. Join support: property addresses

Source:

- Dataset page: https://opendata.vancouver.ca/explore/dataset/property-addresses/table/

Why we need it:

- Helps normalize and join City address records to parcel polygons and permits.
- The City notes that this dataset is for parcel polygon display and is not a complete set of all addresses, so it should be join support, not the canonical backbone.

Useful fields:

- address / civic number
- street name
- unit if available
- coordinates / geometry if available
- parcel link fields if available

Recommended export URL:

```text
https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-addresses/exports/csv
```

## 5. Join support: property parcel polygons

Source:

- Dataset page: https://opendata.vancouver.ca/explore/dataset/property-parcel-polygons/table/

Why we need it:

- Useful for parcel geometry and spatial joins.
- Helps attach zoning, local area, and spatial cluster features.
- The City describes these as assessment-based land polygons, which is relevant to matching BC Assessment-style records.

Recommended export URL:

```text
https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-parcel-polygons/exports/geojson
```

Exploration questions:

- Does the parcel dataset expose a stable parcel ID useful for joining?
- Does the geometry align with BC Assessment / PID records?
- Can condos/strata units be handled without over-collapsing to parcel level?

## 6. Context feature: zoning districts and labels

Source:

- Dataset page: https://opendata.vancouver.ca/explore/dataset/zoning-districts-and-labels/table/

Why we need it:

- Adds zoning context for base value and renovation feasibility.
- May help explain why similar property changes produce different uplift in different zones.

Recommended export URL:

```text
https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/zoning-districts-and-labels/exports/geojson
```

## 7. Optional commercial fallback: Landcor

Source:

- Automated valuation / profiler reports: https://www.landcor.com/automated-property-valuation/
- Property profiler: https://www.landcor.com/online-property-tools/property-profiler

Why it might help:

- Landcor reports advertise BC Assessment values, property details, permit history, sales history, title information, and recent sales context.
- This appears useful if BC Assessment custom extract access is delayed, but it is commercial and may not be available as a clean research/bulk dataset.

Exploration questions:

- Can Landcor provide a bulk extract, not only individual reports?
- Can usage terms support model training?
- Does the extract include sale date, sale price, permit history, and property attributes at scale?

## Minimum Observed Uplift Training Table

Target table: one row per qualifying quick-flip event.

Columns:

- property_id
- property_type
- postal_code
- latitude
- longitude
- zoning_district
- pre_sale_date
- pre_sale_price
- permit_issue_date
- last_qualifying_permit_issue_date
- post_sale_date
- post_sale_price
- days_from_last_permit_to_resale
- living_area_sqft_pre
- bedrooms_pre
- bathrooms_pre
- lot_size_sqft
- year_built
- pre_assessed_land_value
- pre_assessed_improvement_value
- post_assessed_land_value
- post_assessed_improvement_value
- permit_project_value_total
- permit_category_summary
- type_of_work_summary
- project_description_text
- renovatedKitchen
- renovatedBathrooms
- legalSuiteAdded
- energyEfficient
- deferredMaintenanceResolved
- roofIssueResolved
- counterfactual_as_is_value_at_post_sale_date
- uplift_label = post_sale_price - counterfactual_as_is_value_at_post_sale_date
- label_source = observed

## Label Rules To Explore

Observed row rule:

- same property has pre-sale
- qualifying renovation permit(s) occur
- resale happens 90-365 days after last qualifying permit issuance
- target is signed uplift:

```text
uplift = actual_post_sale_price - layer1_counterfactual_as_is_value_at_post_sale_date
```

Exclude:

- new construction
- demolition
- land assembly
- salvage / abatement only
- non-arm's-length or invalid transfers
- commercial / industrial / multi-family if outside v1 scope
- suspicious sales with extreme price changes and no renovation signal

Do not use proxy row labels in the live uplift model. If observed resale examples are thin, return `data-missing` instead of training a weaker model.

## What I Recommend You Explore First

1. Request or obtain BC Assessment Vancouver sales/inventory extract.
2. Download City issued building permits and profile:
   - residential additions/alterations/repairs count
   - project value missingness
   - permit category distribution
   - address join quality
3. Download property tax report for context only:
   - annual improvement-value jumps
   - `big_improvement_year` quality
   - address/postal-code join quality
4. Try a small manual join sample:
   - 100 permit addresses
   - match to property-tax rows
   - match to sales rows
   - inspect whether timelines make sense
5. Only after the join works, build the uplift model.

## Decision Gate

If you cannot get property-level sales transaction history:

- do not call the second model a true uplift model
- return `data-missing`
- do not generate rows or train on permit/assessment proxy labels

If you can get sales transaction history:

- retrain Layer 1 on actual sale price
- create observed quick-flip uplift labels
- train Layer 2 on observed uplift only
