"""The stored Halifax join rate is not treated as a remeasurement."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.setup_halifax_data import MIN_SALE_TO_DWELLING_JOIN_RATE


def test_stored_join_rate_does_not_equal_the_stored_counts() -> None:
    summary = json.loads(Path("data/processed/halifax_base_model_summary.json").read_text(encoding="utf-8"))
    numerator = summary["rows"]["joinedToDwellings"]
    denominator = summary["rows"]["windowSales"]
    stored_rate = summary["rates"]["saleToDwellingJoin"]
    quotient = numerator / denominator

    assert numerator == 18268
    assert denominator == 25160
    assert stored_rate == 0.7715
    assert quotient == pytest_approx(18268 / 25160)
    assert summary["joinAudit"]["remeasured"] is False
    assert summary["joinAudit"]["storedRateMatchesQuotientOfStoredCounts"] is False
    assert summary["rawLineageRecovered"] is False
    assert MIN_SALE_TO_DWELLING_JOIN_RATE == 0.90


def pytest_approx(value: float):
    import pytest

    return pytest.approx(value, abs=0.0001)
