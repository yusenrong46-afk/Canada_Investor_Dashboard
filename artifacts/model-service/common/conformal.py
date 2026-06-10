"""Split conformal prediction for valuation confidence bands.

Holdout rows are shuffle-split into a calibration half and a coverage-check half.
Nonconformity scores are relative residuals |actual - predicted| / predicted, so the
band scales with price; the band ratio is the finite-sample-corrected
ceil((n + 1) * (1 - alpha)) / n empirical quantile of the calibration scores. This
guarantees >= 1 - alpha marginal coverage under exchangeability — it is an average
guarantee across listings, not a per-property (conditional) one. Coverage is verified
empirically on the held-back half rather than assumed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ConformalCalibration:
    alpha: float
    target_coverage: float
    ratio: float
    empirical_coverage: float | None
    calibration_rows: int
    coverage_rows: int


def _clean_pairs(actual: np.ndarray, predicted: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    actual_values = np.asarray(actual, dtype=float).ravel()
    predicted_values = np.asarray(predicted, dtype=float).ravel()
    if actual_values.size == 0 or predicted_values.size == 0:
        raise ValueError("actual and predicted must be non-empty")
    if actual_values.size != predicted_values.size:
        raise ValueError("actual and predicted must have the same length")
    usable = np.isfinite(actual_values) & np.isfinite(predicted_values) & (predicted_values > 0)
    if not usable.any():
        raise ValueError("no rows with finite values and positive predictions remain")
    return actual_values[usable], predicted_values[usable]


def conformal_ratio(actual: np.ndarray, predicted: np.ndarray, alpha: float) -> float:
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be in (0, 1)")
    actual_values, predicted_values = _clean_pairs(actual, predicted)
    scores = np.sort(np.abs(actual_values - predicted_values) / predicted_values)
    n = scores.size
    rank = math.ceil((n + 1) * (1.0 - alpha))
    # rank > n means the finite-sample quantile is unbounded; clamp to the max score.
    return float(scores[min(rank, n) - 1])


def empirical_coverage(actual: np.ndarray, predicted: np.ndarray, ratio: float) -> float:
    if ratio < 0.0:
        raise ValueError("ratio must be non-negative")
    actual_values, predicted_values = _clean_pairs(actual, predicted)
    lower = predicted_values * (1.0 - ratio)
    upper = predicted_values * (1.0 + ratio)
    covered = (actual_values >= lower) & (actual_values <= upper)
    return float(np.mean(covered))


def calibrate_split_conformal(
    actual: np.ndarray,
    predicted: np.ndarray,
    alpha: float = 0.2,
    coverage_split: float = 0.5,
    random_state: int = 42,
) -> ConformalCalibration:
    if not 0.0 < coverage_split < 1.0:
        raise ValueError("coverage_split must be in (0, 1)")
    actual_values, predicted_values = _clean_pairs(actual, predicted)
    n = actual_values.size
    coverage_count = int(math.floor(n * coverage_split))

    if coverage_count < 20:
        # Too few rows for a trustworthy coverage check: calibrate on everything
        # and report that coverage was not measured rather than invent a number.
        ratio = conformal_ratio(actual_values, predicted_values, alpha)
        return ConformalCalibration(
            alpha=float(alpha),
            target_coverage=float(1.0 - alpha),
            ratio=ratio,
            empirical_coverage=None,
            calibration_rows=int(n),
            coverage_rows=0,
        )

    rng = np.random.default_rng(random_state)
    order = rng.permutation(n)
    coverage_index = order[:coverage_count]
    calibration_index = order[coverage_count:]

    ratio = conformal_ratio(actual_values[calibration_index], predicted_values[calibration_index], alpha)
    coverage = empirical_coverage(actual_values[coverage_index], predicted_values[coverage_index], ratio)
    return ConformalCalibration(
        alpha=float(alpha),
        target_coverage=float(1.0 - alpha),
        ratio=ratio,
        empirical_coverage=coverage,
        calibration_rows=int(calibration_index.size),
        coverage_rows=int(coverage_index.size),
    )
