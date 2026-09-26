"""Halifax sale identity and Vancouver listing-row fingerprints. Offline fixtures only."""

from __future__ import annotations

import pandas as pd
import pytest

from scripts.identities import assign_sale_identity, attach_identity
from scripts.release_store import LINEAGE_FIXTURE, content_sha256_bytes, snapshot_record


def _sale(**overrides: object) -> dict:
    row = {
        "aan": "100",
        "sale_date": "2024-05-01",
        "sale_price": 400000,
        "postal": "B3H",
    }
    row.update(overrides)
    return row


def test_fallback_sale_key_allows_repeat_accounts_and_rejects_collisions() -> None:
    sales = pd.DataFrame(
        [
            _sale(aan="100", sale_date="2024-01-01", sale_price=300000),
            _sale(aan="100", sale_date="2024-06-01", sale_price=450000),
        ]
    )
    identity = assign_sale_identity(sales)
    assert list(identity["accountId"]) == ["100", "100"]
    assert identity["saleObservationId"].is_unique
    assert identity["identityKind"].iloc[0] == "snapshot_observation:aan|sale_date"
    assert identity["crossSnapshotMatch"].iloc[0] == "price_correction"
    assert identity["saleObservationId"].iloc[0] == "100|2024-01-01"

    collided = pd.DataFrame(
        [
            _sale(aan="100", sale_date="2024-06-01", sale_price=450000),
            _sale(aan="100", sale_date="2024-06-01", sale_price=450000),
        ]
    )
    with pytest.raises(ValueError, match="not unique"):
        assign_sale_identity(collided)


def test_replay_and_shuffle_keep_source_sale_ids() -> None:
    sales = pd.DataFrame(
        [
            _sale(aan="1", **{":id": "tx-1"}, sale_price=10),
            _sale(aan="1", **{":id": "tx-2"}, sale_date="2024-07-01", sale_price=12),
            _sale(aan="2", **{":id": "tx-3"}, sale_price=8),
        ]
    )
    first = assign_sale_identity(sales)
    second = assign_sale_identity(sales)
    shuffled = assign_sale_identity(sales.sample(frac=1, random_state=3))
    assert first["saleObservationId"].tolist() == second["saleObservationId"].tolist()
    assert sorted(first["saleObservationId"]) == sorted(shuffled["saleObservationId"])
    assert first["identityKind"].iloc[0] == "snapshot_observation::id"
    assert first["crossSnapshotMatch"].iloc[0] == "unsupported"


def test_verified_transaction_id_survives_a_price_correction() -> None:
    original = pd.DataFrame([_sale(aan="55", sale_transaction_id="txn-55", sale_price=100000, postal="B3H")])
    corrected = original.copy()
    corrected.loc[0, "sale_price"] = 125000
    corrected.loc[0, "postal"] = "B3J"

    before = assign_sale_identity(original)
    after = assign_sale_identity(corrected)
    assert before["saleObservationId"].iloc[0] == after["saleObservationId"].iloc[0] == "txn-55"
    assert before["crossSnapshotMatch"].iloc[0] == "supported"
    assert after["identityKind"].iloc[0] == "source:sale_transaction_id"
    assert before["accountId"].iloc[0] == after["accountId"].iloc[0] == "55"

    combined = pd.concat([original.assign(snapshot="v1"), corrected.assign(snapshot="v2")], ignore_index=True)
    with pytest.raises(ValueError, match="not unique"):
        assign_sale_identity(combined.drop(columns=["snapshot"]))

    first_snapshot = snapshot_record(
        name="halifax-sale-tx-55",
        lineage_class=LINEAGE_FIXTURE,
        content_sha256=content_sha256_bytes(original.to_csv(index=False).encode()),
        storage_ref="fixture://v1",
        fetched_at="2026-01-01T00:00:00+00:00",
    )
    second_snapshot = snapshot_record(
        name="halifax-sale-tx-55",
        lineage_class=LINEAGE_FIXTURE,
        content_sha256=content_sha256_bytes(corrected.to_csv(index=False).encode()),
        storage_ref="fixture://v2",
        fetched_at="2026-02-01T00:00:00+00:00",
    )
    assert first_snapshot["contentSha256"] != second_snapshot["contentSha256"]
    assert first_snapshot["ingestion"]["fetchedAt"] != second_snapshot["ingestion"]["fetchedAt"]


def test_snapshot_row_id_and_price_fallback_do_not_claim_stable_matching() -> None:
    original_row = _sale(aan="55", sale_price=100000, **{":id": "row-55"})
    corrected_row = dict(original_row)
    corrected_row["sale_price"] = 125000
    before = assign_sale_identity(pd.DataFrame([original_row]))
    after = assign_sale_identity(pd.DataFrame([corrected_row]))
    assert before["saleObservationId"].iloc[0] == after["saleObservationId"].iloc[0] == "row-55"
    assert before["identityKind"].iloc[0] == "snapshot_observation::id"
    assert before["crossSnapshotMatch"].iloc[0] == "unsupported"
    assert after["crossSnapshotMatch"].iloc[0] == "unsupported"

    fallback_before = assign_sale_identity(pd.DataFrame([_sale(aan="55", sale_price=100000)]))
    fallback_after = assign_sale_identity(pd.DataFrame([_sale(aan="55", sale_price=125000)]))
    assert fallback_before["crossSnapshotMatch"].iloc[0] == "price_correction"
    assert fallback_before["identityKind"].iloc[0] == "snapshot_observation:aan|sale_date"
    assert fallback_before["saleObservationId"].iloc[0] == fallback_after["saleObservationId"].iloc[0]
    assert fallback_before["accountId"].iloc[0] == fallback_after["accountId"].iloc[0] == "55"

    same_day = pd.DataFrame(
        [
            _sale(aan="55", sale_date="2024-05-01", sale_price=100000),
            _sale(aan="55", sale_date="2024-05-01", sale_price=125000),
        ]
    )
    same_day_identity = assign_sale_identity(same_day)
    assert set(same_day_identity["identityKind"]) == {"snapshot_observation:aan|sale_date|sale_price"}
    assert set(same_day_identity["crossSnapshotMatch"]) == {"unsupported"}
    corrected_same_day = same_day.copy()
    corrected_same_day.loc[0, "sale_price"] = 110000
    corrected_identity = assign_sale_identity(corrected_same_day)
    assert same_day_identity["saleObservationId"].iloc[0] != corrected_identity["saleObservationId"].iloc[0]


def test_non_key_correction_keeps_the_attached_sale_id() -> None:
    row = {
        "accountId": "55",
        "saleObservationId": "tx-55",
        "identityKind": "source:sale_transaction_id",
        "crossSnapshotMatch": "supported",
        "saleDate": "2024-05-01",
        "postalCode": "B3H1A1",
        "salePrice": 100000,
        "livingAreaSqft": 1200,
        "latitude": 44.65,
        "longitude": -63.6,
        "propertyType": "Detached",
    }
    original = attach_identity(pd.DataFrame([row]), "halifax_maritimes")
    corrected = row.copy()
    corrected["salePrice"] = 125000
    corrected["postalCode"] = "B3J2B2"
    updated = attach_identity(pd.DataFrame([corrected]), "halifax_maritimes")
    assert original["propertyObservationId"].iloc[0] == updated["propertyObservationId"].iloc[0]
    assert original["propertyObservationId"].iloc[0] == "halifax:sale:tx-55"
    assert original["crossSnapshotMatch"].iloc[0] == "supported"
    assert updated["crossSnapshotMatch"].iloc[0] == "supported"

    dated = {
        "accountId": "55",
        "saleObservationId": "55|2024-05-01",
        "identityKind": "snapshot_observation:aan|sale_date",
        "crossSnapshotMatch": "price_correction",
        "saleDate": "2024-05-01",
        "postalCode": "B3H1A1",
        "salePrice": 100000,
        "livingAreaSqft": 1200,
        "latitude": 44.65,
        "longitude": -63.6,
        "propertyType": "Detached",
    }
    priced = attach_identity(pd.DataFrame([dated]), "halifax_maritimes")
    dated["salePrice"] = 140000
    dated["crossSnapshotMatch"] = "supported"
    repriced = attach_identity(pd.DataFrame([dated]), "halifax_maritimes")
    assert priced["propertyObservationId"].iloc[0] == repriced["propertyObservationId"].iloc[0]
    assert repriced["crossSnapshotMatch"].iloc[0] == "price_correction"


def test_vancouver_fingerprint_is_not_stable_when_listing_fields_change() -> None:
    row = {
        "postalCode": "V6B1X9",
        "propertyType": "Condo",
        "price": 800000,
        "livingAreaSqft": 900,
        "latitude": 49.28,
        "longitude": -123.12,
        "bedrooms": 2,
        "bathrooms": 2,
    }
    first = attach_identity(pd.DataFrame([row]), "vancouver")
    changed = dict(row)
    changed["price"] = 810000
    second = attach_identity(pd.DataFrame([changed]), "vancouver")
    assert first["identityKind"].iloc[0] == "listing_row_fingerprint"
    assert first["propertyObservationId"].iloc[0] != second["propertyObservationId"].iloc[0]
    replay = attach_identity(pd.DataFrame([row]), "vancouver")
    assert first["propertyObservationId"].iloc[0] == replay["propertyObservationId"].iloc[0]


def test_processed_halifax_rows_without_aan_use_a_labeled_fingerprint() -> None:
    row = {
        "saleDate": "2024-05-01",
        "postalCode": "B3H1A1",
        "salePrice": 500000,
        "livingAreaSqft": 1600,
        "latitude": 44.65,
        "longitude": -63.6,
        "propertyType": "Detached",
    }
    identified = attach_identity(pd.DataFrame([row, row]), "halifax_maritimes")
    assert identified["identityKind"].iloc[0] == "processed_row_fingerprint"
    assert identified["propertyObservationId"].duplicated().any()
