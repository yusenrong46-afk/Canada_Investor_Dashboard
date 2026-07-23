from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from scripts.build_halifax_uplift import EARTH_RADIUS_METERS, match_permits_to_dwellings  # noqa: E402


def _offset_meters(latitude: float, longitude: float, north_meters: float) -> tuple[float, float]:
    delta_lat = north_meters / EARTH_RADIUS_METERS * (180.0 / np.pi)
    return latitude + delta_lat, longitude


def test_match_permits_to_dwellings_respects_30m_cutoff() -> None:
    base_lat, base_lon = 44.6500, -63.6000
    near_lat, _ = _offset_meters(base_lat, base_lon, 29.0)
    far_lat, _ = _offset_meters(base_lat, base_lon, 31.0)

    dwellings = pd.DataFrame(
        {
            "aan": ["A1"],
            "latitude": [base_lat],
            "longitude": [base_lon],
        }
    )
    permits = pd.DataFrame(
        {
            "issuedDate": pd.to_datetime(["2024-01-01", "2024-02-01"]),
            "workScope": ["Renovation", "Renovation"],
            "projectValue": [25_000.0, 25_000.0],
            "latitude": [near_lat, far_lat],
            "longitude": [base_lon, base_lon],
        }
    )

    matched = match_permits_to_dwellings(permits, dwellings, max_meters=30.0)

    assert len(matched) == 1
    assert matched.iloc[0]["aan"] == "A1"
    assert matched.iloc[0]["matchDistanceMeters"] <= 30.0
