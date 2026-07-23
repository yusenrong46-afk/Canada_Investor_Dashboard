# Phase 0 — Complete Data Understanding

Date: 2026-07-22  
Repo: `canadian-investor-dashboard-g1-release` @ `codex/resume-release-g1`  
North star: improve model foundation by fixing poor data handling — not by chasing prettier algorithms.

This autopsy is the gate before cleaning, feature engineering, retraining, uplift upgrades, or trust-UI work.

---

## 1. Dataset inventory

| Dataset | Path | Rows | Cols | Grain | Join / key fields |
|---|---|---:|---:|---|---|
| Vancouver processed training | `data/processed/vancouver_base_model_training.csv` | 3,518 | 16 | One Vancouver listing used for base-price training | soft key: postal + size + beds/baths + price + type + lat/lon |
| Vancouver processed summary | `data/processed/vancouver_base_model_summary.json` | — | — | Export metadata / EDA | sourcePath points at a `data_bc.csv` |
| Halifax processed training | `data/processed/halifax_base_model_training.csv` | 17,998 | 23 | One HRM ground-oriented sale (2022+) time-adjusted | `saleDate` + dwelling traits + postal + assessedValue |
| Halifax processed summary | `data/processed/halifax_base_model_summary.json` | — | — | Build rates / sources | sources under main-repo `data/raw/halifax/` |
| Vancouver raw listings | `/Users/thomas/Downloads/data_bc.csv` (alt twin under `CanadaHousingData/`) | 24,382 | 396 | One BC scrape listing row | locality / postal / price / beds / baths / sqft |
| Halifax dwellings (raw) | `…/canadian-investor-dashboard/data/raw/halifax/pvsc_dwelling_characteristics_hrm.csv` | 136,422 | 21 | One PVSC dwelling account (`aan`) | `aan`, lat/lon, style, area, beds/baths, year_built |
| Halifax sales (raw) | `…/pvsc_parcel_sales_hrm.csv` | 80,320 | 14 | One parcel sale | `aan`, `sale_date`, `sale_price` |
| Halifax assessments (raw) | `…/pvsc_assessed_values_hrm.csv` | 344,444 | 14 | One account × tax year | `aan`, `tax_year`, assessed value |
| Halifax civic addresses (raw) | `…/hrm_civic_addresses.csv` | 158,354 | 8 | One civic point | PID, postal, lat/lon |
| Halifax permits (raw) | `…/hrm_building_permits_geolocated.csv` | 15,739 | 32 | One geolocated permit | lat/lon, work scope, issued date, project value |
| Halifax uplift export | `data/exports/halifax_uplift.json` | aggregate | — | Category-level medians only (no pair rows shipped) | Renovation / Addition |
| Model bundles + MANIFEST | `artifacts/model-service/models/` | 2 approved pickles | — | Shipped live artifacts | Vancouver v5 (2026-07-18), Halifax v1 (2026-07-22) |

**Not present in this worktree:** `data/raw/` (Halifax/Seattle raw live in the sibling main checkout). Warehouse DuckDB was not required for Phase 0 row understanding.

Machine-readable profiles: `reports/data-autopsy/column_profiles.json`.

---

## 2. Per-market data stories (what one row means)

### Vancouver

A processed row is a **listing-price** observation for a Vancouver property type (Condo / Detached / Duplex / Townhouse), with living area, beds, baths, postal/FSA, postal-centroid lat/lon, engineered coordinate terms, optional property tax, and a **full-extract** `submarketCluster` label.

It is **not** a closed sale. It has **no usable listing date** in either the processed extract or the available raw CSV. Temporal train/test is therefore impossible until a dated source exists.

### Halifax

A processed row is a **time-adjusted sale-price** observation for a ground-oriented HRM dwelling (Detached / Duplex / Townhouse — **no Condo**). Raw sale price is scaled by an HRM monthly median index to baseline month `2026-05`. Postal codes come from nearest civic address (≤150 m). Assessed value is present on 100% of training rows. `saleDate` is complete (`2022-01-04` … `2026-05-28`).

### Uplift (Halifax observed)

A treated unit is a **repeat-sale pair** (same `aan`, ≥180 days apart) with a non-`New Building` permit of a given `PRIMARY_WORK_SCOPE` issued strictly between sales, matched to a dwelling within 30 m. Controls are pairs with no permit between sales. Export stores only category aggregates; pair dumps for this autopsy were rebuilt locally into `reports/data-autopsy/uplift_treated_*.csv`.

---

## 3. Column findings (training features + targets)

### Vancouver processed — every shipped column

| Column | Role | Finding |
|---|---|---|
| `price` | **target** (listing) | 289.9k–19.8M; median ~1.50M; no nulls/negatives |
| `logPrice` | train transform | derived from price |
| `pricePerSqft` | context / sanity | ~306–3,245 $/sqft after outlier filters |
| `propertyType` | segment | Condo 1992, Detached 996, Duplex 284, Townhouse 246 |
| `postalCode` / `postalFsa` | location | present; 31 FSAs; 2 FSAs with <20 rows |
| `submarketCluster` | categorical feature | 12 labels **baked into extract** (full-data cluster risk if reused blindly) |
| `livingAreaSqft` | core feature | 310–9,670; no zeros |
| `bedrooms` / `bathrooms` | core features | **78 zero-bed**, **14 zero-bath** rows remain |
| `latitude` / `longitude` (+ products) | location | postal-centroid approximation, not parcel pins |
| `propertyTax` | optional numeric | **51.8% missing**; min observed non-null = **$1** (15 suspicious) |
| `listingDate` | temporal key | **ABSENT from processed extract** |
| `yearBuilt` / `ageYears` | age | **ABSENT**; raw `Year Built` also 0 non-null |

### Halifax processed — every shipped column

| Column | Role | Finding |
|---|---|---|
| `price` | **target** (time-adjusted sale) | ~100k–4.48M; median ~595k |
| `salePrice` / `saleDate` | raw target + time key | `saleDate` **17,998/17,998 non-null** |
| `timeAdjustmentFactor` | index scale | 1.00–1.29; **never hits 0.5/2.0 clips** in this extract |
| `logPrice` / `pricePerSqft` | transforms / context | derived |
| `propertyType` | segment | Detached 14,751 / Duplex 2,401 / Townhouse 846 |
| `postalCode` / `postalFsa` | location | **75 null postals** (all Detached) |
| `submarketCluster` | categorical | present in extract (same full-data caution) |
| `livingAreaSqft` | core | 300–9,648 |
| `bedrooms` / `bathrooms` | core | 1 zero-bed; **50 zero-bath**; `bedroomsImputed` **11.73%** |
| `ageYears` | feature | 4.2% missing; **24 rows age > 150** including **466 years** |
| `assessedValue` | feature / sanity | 100% present; price/assessed median 1.077; **182 rows** outside [0.3, 3] |
| `h3Cell` | location encoding | present |
| `propertyTax` | n/a | null (Halifax) |
| `latitude` / `longitude` | parcel coords | no nulls in processed extract |

### Raw Vancouver date audit (blocker proof)

Both `/Users/thomas/Downloads/data_bc.csv` and `/Users/thomas/Downloads/CanadaHousingData/data_bc.csv` (24,382 rows each):

| Column | Non-null count |
|---|---:|
| `Date Listed` | **0** |
| `Last Updated` | **0** |
| `Listing ID` | **0** |
| `Year Built` | **0** |

Locality containing “vancouver”: 5,083 / 24,382 raw rows. Dates remain empty on that subset too.

**Verdict:** Vancouver temporal holdout is **not feasible** with currently available raw files. Do not invent dates.

---

## 4. Top 20 defects (ranked by impact on honesty / accuracy)

1. **Vancouver listing dates entirely empty** → blocks Phase E temporal training; shipped Vancouver metrics remain random-split / pre-Phase-E.
2. **Vancouver `Year Built` empty in raw** → no honest age feature for YVR without a new source.
3. **`submarketCluster` baked into processed extracts** → full-data cluster labels can leak geography if training reuses the CSV as-is instead of refitting clusters on the train fold only.
4. **Vancouver target is listing price, not sale price** → irreducible label noise vs Halifax sales.
5. **Halifax Duplex conformal under-coverage (~71.6%)** → thin/noisy segment; data volume + heterogeneity, not just model choice.
6. **Halifax bedrooms imputed 11.7%** → softens a core feature; must stay flagged and train-fold-safe.
7. **75 Halifax training rows missing postal/FSA** → location feature degraded / null handling risk.
8. **Permit→dwelling geo match only ~55%** (7,543 / 13,705) → uplift treated set is a selected subset of permits.
9. **Uplift Renovation n=131 only; Addition insufficient (37)** → high variance; p25–p75 spread is descriptive, not CI.
10. **Extreme treated ratios** (adjusted up to ~3.28 / down to ~0.41) → renovation label is coarse; non-reno price drivers remain.
11. **Sales→dwelling join ~93.3% on 2022+ ≥$100k** → ~6.7% sales never enter modelling (orphans dumped).
12. **Style exclusion removes a large ground-oriented subset** (summary: 16,450 style-excluded vs 17,998 clean) → Condo absence + style map gaps.
13. **Vancouver 78 zero-bed / 14 zero-bath rows kept** → likely scrape/parse defects.
14. **Halifax 50 zero-bath rows** → characteristic quality issue.
15. **Halifax ageYears > 150 (24 rows; max 466)** → year_built corruption.
16. **182 Halifax price/assessed outliers outside [0.3, 3]** → possible non-market residue or assessment lag.
17. **Vancouver propertyTax 51.8% missing + $1 sentinels** → weak/noisy feature.
18. **Vancouver lat/lon are postal centroids** → spatial CV gaps / neighborhood memorization risk already visible in metrics report.
19. **HRM-wide time index** (not submarket) → residual time structure inside holdouts.
20. **Uplift export is aggregate-only** → no shipped pair-level audit trail in product data (rebuilt only in this autopsy folder).

Soft sanity dump: `failed_sanity_rows.csv` (241 soft flags). Hard illegal price/area/postal patterns on processed extracts: **0**.

---

## 5. Join graph (measured)

```text
PVSC sales (2022+, ≥$100k)
   │  aan
   ├──────────────► PVSC dwellings          join rate 93.27%  (24,240 / 25,988)
   │                     │
   │                     ├─ aan ──► 2026 assessments     100% of joined sales
   │                     │
   │                     └─ geo ≤150m ──► civic postal   training still has 75 null postals
   │
PVSC dwellings ◄── geo ≤30m ── HRM permits             match 55.04% (7,543 / 13,705)
   │
repeat-sale pairs (16,738) ── permit-between-sales ──► treated Renovation 131 / Addition 37
                              no-permit-between      ──► controls 16,445
```

Orphans sample: `join_orphans.csv`, `join_orphans_sales_without_dwelling.csv`.

---

## 6. Temporal feasibility verdict

| Market | Date field | Coverage | Temporal holdout feasible? |
|---|---|---|---|
| Vancouver | `listingDate` / raw `Date Listed`+`Last Updated` | **0 usable** | **NO** — fail closed unless `ALLOW_RANDOM_HOLDOUT=1` / `ALLOW_EMPTY_DATES=1` |
| Halifax | `saleDate` | **100%** on processed | **YES** — last 6 months from max date ≈ **1,356** rows (matches shipped temporal N) |

---

## 7. Uplift constructibility verdict

Constructible as an **observational, descriptive** layer:

- Control median adjusted ratio **1.035** (passes ±10% sanity).
- Renovation **ready** (131 ≥ 100); Addition **insufficient-data** (37).
- Treated Renovation adjustedRatio p25/p50/p75 ≈ 1.03 / 1.16 / 1.59 → export excess band after subtracting control median is wide (**~-0.4% to +55.9%**).
- Pair examples and extremes: `uplift_treated_*.csv`, `uplift_control_random10.csv`, `extreme_uplift_pairs.csv`.

**Not** local causal proof. Do not sum independent reno flags without co-occurrence evidence. Vancouver path remains Seattle proxy (raw Seattle not re-audited here because foundation blocker is YVR dates + HAL pair quality first).

---

## 8. Target + leakage audit

| Item | Status |
|---|---|
| Vancouver target = listing price | Confirmed |
| Halifax target = time-adjusted sale price | Confirmed (`price = salePrice × timeAdjustmentFactor`) |
| Assessed value is not the Halifax target | Confirmed (feature only) |
| Train-only ship / conformal coverage (Halifax code path) | Present in `halifax_model/core.py` (`train_only`, age impute on train index, cluster fit on train coords) |
| Vancouver training without dates | Fail-closed unless escape hatch |
| Processed CSV `submarketCluster` | **Leakage hazard if reused**; training code can refit, but demo extracts currently ship precomputed labels |
| Uplift monthly index built from full sales history | Documented in builder; acceptable for descriptive excess uplift, not a base-price conformal claim |

Static scan notes live under `column_profiles.json` → `leakage_static_scan`.

---

## 9. Do not train until… (fail-closed checklist)

### Vancouver base model
- [ ] Obtain a raw listings file with **populated** `Date Listed` and/or `Last Updated` (prove non-null count ≫ 0 on Vancouver locality).
- [ ] Re-export via `scripts/export_base_model_data.py` with `listingDate` present and `temporalHoldoutReady: true` (**no** `ALLOW_EMPTY_DATES=1` for a real retrain).
- [ ] Quarantine or explicitly policy-handle zero beds/baths and `$1` tax sentinels.
- [ ] Ensure `submarketCluster` / any medians are **fit on temporal train fold only** at train time (do not trust baked CSV clusters).
- [ ] Only then run `scripts/train_model_bundles.py --market vancouver` and regenerate MANIFEST + metrics report.

### Halifax base model
- [x] `saleDate` complete and temporal holdout sized.
- [ ] Decide policy for ageYears > 150 / year_built corruption (drop vs clip vs null+impute flag).
- [ ] Decide policy for missing postal (75 rows): drop from train vs keep with null FSA handling.
- [ ] Decide policy for zero baths / price-assessed extremes.
- [ ] Keep bedrooms imputation flagged; verify train-fold-only behavior remains.
- [ ] After cleaning, retrain only if a measured defect fix is expected to change holdout behavior; publish honest temporal metrics even if worse.

### Uplift
- [ ] Keep aggregate labels honest (`observed` / descriptive spread).
- [ ] Do not promote Addition until ≥100 treated pairs **or** explicitly keep `insufficient-data`.
- [ ] Before claiming uplift “upgrade,” fix pair/permit join quality and document remaining selection bias (45% unmatched permits).

### Global
- [ ] No invented dates, no fake condos for Halifax, no claiming public Vercel mode is fitted ML.
- [ ] Prefer honest worse temporal MAPE over leaked nicer random MAPE.

---

## 10. Line-level review artifacts

| Artifact | Purpose |
|---|---|
| `vancouver_random_50.csv` / `halifax_random_50.csv` | random full-row reads |
| `vancouver_cheapest_20.csv` / `vancouver_most_expensive_20.csv` | price extremes |
| `halifax_cheapest_20.csv` / `halifax_most_expensive_20.csv` | price extremes |
| `vancouver_sample_*.csv` / `halifax_sample_*.csv` | per property type |
| `vancouver_raw_sample_20.csv` | raw scrape rows |
| `vancouver_zero_beds_or_baths.csv` | YVR zero bed/bath |
| `halifax_missing_postal.csv` | null postal rows |
| `halifax_extreme_price_vs_assessed.csv` | assessed sanity extremes |
| `halifax_raw_*_head15.csv` | raw schema samples |
| `uplift_treated_*` / `uplift_control_random10.csv` | pair stories |
| `extreme_uplift_pairs.csv` | high/low excess uplift pairs |
| `failed_sanity_rows.csv` | soft defect index |
| `join_orphans*.csv` | join failures |
| `column_profiles.json` | full column autopsy |
| `notes.json` | machine notes from runner |

---

## 11. Immediate data risks (verified vs prior assumptions)

| Prior claim | Verified? |
|---|---|
| Halifax temporal MAE ~$90k / MAPE ~15.8% | Still what `reports/model_metrics_report.md` says; holdout N=1,356 matches autopsy cutoff size |
| Vancouver still pre–Phase E / undated | **Confirmed** — dates empty; processed extract lacks `listingDate` |
| Duplex conformal weak | Still documented in metrics report |
| Uplift Renovation ready / Addition insufficient | **Confirmed** by rebuild (131 / 37) |
| Public ≠ live pickles | Unchanged product truth; not retested in this autopsy |

---

## 12. Appendix — commands used

```bash
cd /Users/thomas/Documents/canadian-investor-dashboard-g1-release
.venv/bin/python  # forensic profiling + pair rebuild (session scripts)
# Raw Halifax read from sibling checkout:
# /Users/thomas/Documents/canadian-investor-dashboard/data/raw/halifax/
# Raw Vancouver:
# /Users/thomas/Downloads/data_bc.csv
# /Users/thomas/Downloads/CanadaHousingData/data_bc.csv
```

Re-run helper (committed): `scripts/run_data_autopsy.py`.

---

## Next slice after this gate

Phase 1 should start with **defect-backed cleaning only**:

1. Halifax age/postal/zero-bath quarantine policies + fail-closed quality gates.
2. Vancouver: hunt a dated source (do not train); quarantine zero bed/bath + tax sentinels in export.
3. Remove reliance on baked `submarketCluster` in processed CSVs for any retrain path.
4. Only then retrain Halifax (and Vancouver if dates appear).
