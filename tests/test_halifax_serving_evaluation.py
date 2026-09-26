import numpy as np
import pandas as pd

from scripts.halifax_serving_evaluation import evaluate_serving_compatible


def _frame(test_price: float = 400_000) -> pd.DataFrame:
    rows = []
    for month in range(1, 31):
        year = 2022 + (month - 1) // 12
        month_of_year = ((month - 1) % 12) + 1
        for index in range(4):
            property_type = "Detached" if index % 2 == 0 else "Townhouse"
            living_area = 1500 + index * 100
            rows.append(
                {
                    "salePrice": 250_000 + living_area * 100,
                    "saleDate": f"{year}-{month_of_year:02d}-15",
                    "propertyType": property_type,
                    "postalFsa": "B3H",
                    "livingAreaSqft": living_area,
                    "bedrooms": 3,
                    "bathrooms": 2,
                    "latitude": 44.65,
                    "longitude": -63.6,
                    "ageYears": 20,
                    "assessedValue": 10_000_000 if index == 0 else 1,
                    "price": 1,
                    "timeAdjustmentFactor": 99,
                    "lat_x_lon": 0,
                    "lat_sq": 0,
                    "lon_sq": 0,
                }
            )
    frame = pd.DataFrame(rows)
    frame.loc[frame["saleDate"] >= "2024-01-15", "salePrice"] = test_price
    return frame


def test_evaluation_excludes_holdout_from_the_index_and_assessed_value():
    quiet = evaluate_serving_compatible(_frame())
    shocked = evaluate_serving_compatible(_frame(test_price=5_000_000))
    assert quiet["promotedModel"] is False
    assert quiet["replacesShippedBundle"] is False
    assert quiet["assessedValueUsed"] is False
    assert "assessedValue" not in quiet["features"]
    assert quiet["timeAdjustment"]["holdoutMonthsInIndex"] == []
    assert shocked["timeAdjustment"]["baselineMonth"] == quiet["timeAdjustment"]["baselineMonth"]
    assert shocked["timeAdjustment"]["indexMonthCount"] == quiet["timeAdjustment"]["indexMonthCount"]
    assert quiet["splits"]["trainRows"] > 0
    assert quiet["splits"]["calibrationRows"] > 0
    assert quiet["splits"]["testRows"] > 0
    assert quiet["calibration"]["independentOfTest"] is True
    assert 0 <= quiet["calibration"]["testCoverage"] <= 1
    assert quiet["baselines"]["median"]["rows"] == quiet["splits"]["testRows"]
    assert quiet["baselines"]["ridge"]["mae"] >= 0


def test_precomputed_price_and_assessed_value_do_not_change_the_score():
    base = evaluate_serving_compatible(_frame())
    scrambled = _frame()
    scrambled["assessedValue"] = np.arange(len(scrambled)) * 17
    scrambled["price"] = np.arange(len(scrambled))
    scrambled["timeAdjustmentFactor"] = 0.1
    scrambled["lat_x_lon"] = 5
    again = evaluate_serving_compatible(scrambled)
    assert again["baselines"] == base["baselines"]
