from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

MODEL_SERVICE_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from common.conformal import calibrate_split_conformal, conformal_ratio, empirical_coverage  # noqa: E402


def _synthetic_holdout(rows: int, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    predicted = rng.uniform(400_000, 2_500_000, size=rows)
    actual = predicted * (1.0 + rng.normal(0.0, 0.1, size=rows))
    return actual, predicted


def test_calibration_hits_target_coverage_on_synthetic_holdout() -> None:
    actual, predicted = _synthetic_holdout(2000)

    calibration = calibrate_split_conformal(actual, predicted, alpha=0.2)

    assert calibration.ratio > 0.0
    assert calibration.target_coverage == 0.8
    assert calibration.calibration_rows == 1000
    assert calibration.coverage_rows == 1000
    assert calibration.empirical_coverage is not None
    assert 0.73 <= calibration.empirical_coverage <= 0.87


def test_smaller_alpha_gives_wider_band() -> None:
    actual, predicted = _synthetic_holdout(2000)

    strict = conformal_ratio(actual, predicted, alpha=0.05)
    loose = conformal_ratio(actual, predicted, alpha=0.2)

    assert strict >= loose


def test_finite_sample_correction_exceeds_naive_quantile() -> None:
    actual, predicted = _synthetic_holdout(10)
    scores = np.abs(actual - predicted) / predicted

    ratio = conformal_ratio(actual, predicted, alpha=0.2)

    assert ratio >= float(np.quantile(scores, 0.8))


def test_same_random_state_is_deterministic() -> None:
    actual, predicted = _synthetic_holdout(500)

    first = calibrate_split_conformal(actual, predicted, alpha=0.2, random_state=42)
    second = calibrate_split_conformal(actual, predicted, alpha=0.2, random_state=42)

    assert first == second


def test_empty_input_raises_value_error() -> None:
    with pytest.raises(ValueError):
        conformal_ratio(np.array([]), np.array([]), alpha=0.2)
    with pytest.raises(ValueError):
        calibrate_split_conformal(np.array([]), np.array([]))


def test_small_holdout_skips_coverage_check() -> None:
    actual, predicted = _synthetic_holdout(30)

    calibration = calibrate_split_conformal(actual, predicted, alpha=0.2)

    assert calibration.empirical_coverage is None
    assert calibration.coverage_rows == 0
    assert calibration.calibration_rows == 30
    assert calibration.ratio > 0.0


def test_empirical_coverage_counts_rows_inside_band() -> None:
    predicted = np.array([100.0, 100.0, 100.0, 100.0])
    actual = np.array([95.0, 112.0, 100.0, 89.0])

    assert empirical_coverage(actual, predicted, ratio=0.1) == 0.5
