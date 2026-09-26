"""Counting definitions for the processed Vancouver extract. Rows are not deleted."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from scripts.identities import LISTING_FINGERPRINT_COLUMNS, attach_identity, duplicate_id_count


VANCOUVER_CSV = Path(__file__).resolve().parents[1] / "data" / "processed" / "vancouver_base_model_training.csv"


def test_exact_duplicates_and_fingerprint_repeats_are_different_counts() -> None:
    frame = pd.read_csv(VANCOUVER_CSV)
    exact_extra = int(frame.duplicated().sum())
    identified = attach_identity(frame, "vancouver")
    fingerprint_extra = duplicate_id_count(identified["propertyObservationId"])

    fingerprint_groups = []
    exact_groups = 0
    tax_only_groups = 0
    for _, part in identified.groupby("propertyObservationId"):
        if len(part) < 2:
            continue
        raw = frame.loc[part.index]
        fingerprint_groups.append(part)
        varying = [column for column in raw.columns if raw[column].nunique(dropna=False) > 1]
        if not varying:
            exact_groups += 1
        elif varying == ["propertyTax"]:
            tax_only_groups += 1

    assert exact_extra == 7
    assert fingerprint_extra == 9
    assert exact_groups == 7
    assert tax_only_groups == 2
    assert exact_groups + tax_only_groups == len(fingerprint_groups)
    non_fingerprint = [column for column in frame.columns if column not in LISTING_FINGERPRINT_COLUMNS]
    assert "propertyTax" in non_fingerprint
    assert len(identified) == len(frame)
