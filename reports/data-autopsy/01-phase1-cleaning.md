# Phase 1 cleaning — what changed in the rows

Date: 2026-07-22. Implements only defects proven in `00-complete-understanding.md`.

## Halifax extract (`scripts/setup_halifax_data.py`)

| Policy | Before | After |
|---|---|---|
| Bathrooms | allowed 0–10 | **drop** rows with baths &lt; 1 |
| Bedrooms when present | allowed 0–10 | **drop** zeros; missing left **null** |
| Bedroom imputation | full-extract median fill | **no extract fill** (train-fold imputer) |
| ageYears | clipped at 0 | **null** if &lt; 0 or &gt; 150 |
| price / assessed | no gate | **drop** outside [0.3, 3] when assessed present |
| null postal | dropped (strict failed if any) | dropped; strict gates on **match-rate ≥ 95%** |
| submarketCluster | full-data KMeans baked in | placeholder **`unassigned`** |

## Vancouver loader (`base_model/core.py`)

- Require beds/baths in **[1, 10]** (drops zero-bed/bath scrape defects).
- Cap honest age to **≤ 150** (still no usable Year Built in available raw files).
- Temporal training remains **fail-closed** without listing dates.

## Halifax trainer (`halifax_model/core.py`)

- Re-applies the same defensive gates on the CSV.
- Ignores baked cluster labels; refits KMeans on the temporal train fold.

## Not done (blocked)

- Vancouver temporal retrain — need a dated listings source (dates are empty in available `data_bc.csv`).
