"""Undated Vancouver training must not be labeled as a temporal evaluation."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "artifacts" / "model-service"))

from base_model.core import assert_holdout_policy  # noqa: E402


def test_undated_training_fails_without_the_research_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALLOW_RANDOM_HOLDOUT", raising=False)
    with pytest.raises(RuntimeError, match="ALLOW_RANDOM_HOLDOUT"):
        assert_holdout_policy("random 80/20 stratified by price band (no usable listingDate)")


def test_research_override_stays_a_random_split(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOW_RANDOM_HOLDOUT", "1")
    strategy = assert_holdout_policy("random 80/20 stratified by price band (temporal holdout too small)")
    assert strategy.lower().startswith("random")
    assert not strategy.lower().startswith("temporal")


def test_temporal_holdout_does_not_need_the_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALLOW_RANDOM_HOLDOUT", raising=False)
    strategy = assert_holdout_policy("temporal holdout: last 6 months of listingDate")
    assert strategy.startswith("temporal holdout")


def test_committed_vancouver_metrics_heading_is_random_split() -> None:
    from pathlib import Path

    report = Path("reports/model_metrics_report.md").read_text(encoding="utf-8")
    vancouver, _, halifax = report.partition("## Halifax base-price model")
    assert "Random-split MAE" in vancouver
    assert "Temporal MAE" not in vancouver
    assert "Primary split: `80/20 stratified by price band within each property type`" in vancouver
    assert "Temporal MAE" in halifax
    assert "temporal holdout: last 6 months of saleDate" in halifax
