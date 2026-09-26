"""Source identities for Halifax sales and Vancouver listings.

Halifax account identity is the PVSC assessment account number (`aan`).
That value is not unique in raw sales: one account can sell more than once.
`aan` plus sale date is also not assumed to be unique.

`sale_transaction_id` is the only column treated as a verified stable
transaction id. A price correction keeps that id, and cross-snapshot matching
is marked supported.

Socrata `:id` and `sale_id` are snapshot row identifiers. They can label one
extract, but they are not verified to survive a dataset replacement, so
cross-snapshot matching stays unsupported.

Without one of those columns the observation id is `aan|sale_date` when that
pair is unique. A later price correction keeps the same id. The label is
`price_correction`: the id survives a price change, and it is not a
source-issued transaction id. When the same account has more than one sale on
the same day, those rows keep `aan|sale_date|sale_price` and stay unsupported.
A collision on that fuller key is rejected instead of being merged by row position.

Vancouver listing rows in the processed extract have no source property id.
The listing-row fingerprint is a hash of mutable listing fields. It is not a
durable property identifier: editing the price or the coordinates changes the
id, and two identical listing rows collide.
"""

from __future__ import annotations

import hashlib
import math
from typing import Iterable

import pandas as pd


LISTING_FINGERPRINT_COLUMNS = (
    "postalCode",
    "propertyType",
    "price",
    "livingAreaSqft",
    "latitude",
    "longitude",
    "bedrooms",
    "bathrooms",
)

HALIFAX_PROCESSED_FINGERPRINT_COLUMNS = (
    "saleDate",
    "postalCode",
    "salePrice",
    "livingAreaSqft",
    "latitude",
    "longitude",
    "propertyType",
)

# Durable transaction key. Only columns whose semantics have been verified
# belong here. Socrata `:id` does not: a dataset replacement can reassign it.
VERIFIED_STABLE_SALE_ID_COLUMNS = ("sale_transaction_id",)

# Row ids that are unique inside one snapshot and are not a cross-snapshot key.
SNAPSHOT_ROW_ID_COLUMNS = (":id", "sale_id")

CROSS_SNAPSHOT_SUPPORTED = "supported"
CROSS_SNAPSHOT_UNSUPPORTED = "unsupported"
CROSS_SNAPSHOT_PRICE_CORRECTION = "price_correction"
PRICE_CORRECTION_KIND = "snapshot_observation:aan|sale_date"


def _is_missing(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    try:
        return bool(pd.isna(value))
    except TypeError:
        return False


def canonical_token(value: object) -> str:
    if _is_missing(value):
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return format(value, ".10g")
    text = str(value).strip()
    if text.endswith(".0") and text[:-2].lstrip("-").isdigit():
        return text[:-2]
    return text


def fingerprint_frame(frame: pd.DataFrame, columns: Iterable[str]) -> pd.Series:
    column_list = list(columns)
    missing = [column for column in column_list if column not in frame.columns]
    if missing:
        raise ValueError(f"Cannot fingerprint rows; missing columns: {', '.join(missing)}")
    parts = [frame[column].map(canonical_token) for column in column_list]
    canonical = parts[0]
    for part in parts[1:]:
        canonical = canonical.str.cat(part, sep="|")
    return canonical.map(lambda text: hashlib.sha256(text.encode("utf-8")).hexdigest())


def assign_sale_identity(frame: pd.DataFrame) -> pd.DataFrame:
    """Identify each sale row. `aan` is the account, not the sale.

    Raises when the chosen sale key is missing or not unique. Call this on the
    sale table before keeping the latest sale per account.
    """
    if "aan" not in frame.columns:
        raise ValueError("Halifax sale identity requires the upstream aan column")

    account = frame["aan"].map(canonical_token)
    if (account == "").any():
        raise ValueError("Halifax sale identity requires aan on every sale row")

    verified_column = _populated_column(frame, VERIFIED_STABLE_SALE_ID_COLUMNS)
    snapshot_column = _populated_column(frame, SNAPSHOT_ROW_ID_COLUMNS)
    if verified_column is not None:
        sale_id = frame[verified_column].map(canonical_token)
        kind = f"source:{verified_column}"
        cross_snapshot = CROSS_SNAPSHOT_SUPPORTED
    elif snapshot_column is not None:
        sale_id = frame[snapshot_column].map(canonical_token)
        kind = f"snapshot_observation:{snapshot_column}"
        cross_snapshot = CROSS_SNAPSHOT_UNSUPPORTED
    else:
        price_column = "sale_price" if "sale_price" in frame.columns else "salePrice" if "salePrice" in frame.columns else None
        if "sale_date" not in frame.columns or price_column is None:
            raise ValueError("Snapshot Halifax sale key needs sale_date and sale_price")
        dates = pd.to_datetime(frame["sale_date"], errors="coerce")
        if dates.isna().any():
            raise ValueError("Snapshot Halifax sale key needs a parseable sale_date on every row")
        prices = pd.to_numeric(frame[price_column], errors="coerce")
        if prices.isna().any():
            raise ValueError("Snapshot Halifax sale key needs sale_price on every row")
        date_key = account + "|" + dates.dt.strftime("%Y-%m-%d")
        price_key = date_key + "|" + prices.map(canonical_token)
        if price_key.duplicated().any():
            raise ValueError(
                "Halifax sale observation key (snapshot_observation:aan|sale_date|sale_price) is not unique. "
                "Refusing to invent a tie-breaker from row position."
            )
        shared_day = date_key.duplicated(keep=False)
        sale_id = date_key.where(~shared_day, price_key)
        kind = pd.Series(
            PRICE_CORRECTION_KIND,
            index=frame.index,
            dtype="object",
        )
        kind.loc[shared_day] = "snapshot_observation:aan|sale_date|sale_price"
        cross_snapshot = pd.Series(CROSS_SNAPSHOT_PRICE_CORRECTION, index=frame.index, dtype="object")
        cross_snapshot.loc[shared_day] = CROSS_SNAPSHOT_UNSUPPORTED

    if sale_id.duplicated().any():
        raise ValueError(
            "Halifax sale observation key is not unique. "
            "Refusing to invent a tie-breaker from row position."
        )

    return pd.DataFrame(
        {
            "accountId": account,
            "saleObservationId": sale_id,
            "identityKind": kind,
            "crossSnapshotMatch": cross_snapshot,
        },
        index=frame.index,
    )


def _default_cross_snapshot_match(kind: object) -> str:
    if kind == "source:sale_transaction_id":
        return CROSS_SNAPSHOT_SUPPORTED
    if kind == PRICE_CORRECTION_KIND:
        return CROSS_SNAPSHOT_PRICE_CORRECTION
    return CROSS_SNAPSHOT_UNSUPPORTED


def _reconcile_cross_snapshot(kind: pd.Series, claimed: pd.Series) -> pd.Series:
    """Keep a cross-snapshot label only when the identity kind actually supports it."""
    reconciled = pd.Series(CROSS_SNAPSHOT_UNSUPPORTED, index=kind.index, dtype="object")
    reconciled.loc[kind.eq(PRICE_CORRECTION_KIND)] = CROSS_SNAPSHOT_PRICE_CORRECTION
    supported = kind.eq("source:sale_transaction_id") & claimed.astype(str).eq(CROSS_SNAPSHOT_SUPPORTED)
    reconciled.loc[supported] = CROSS_SNAPSHOT_SUPPORTED
    return reconciled


def _populated_column(frame: pd.DataFrame, columns: tuple[str, ...]) -> str | None:
    for column in columns:
        if column in frame.columns and frame[column].map(_is_missing).sum() == 0:
            return column
    return None


def attach_identity(frame: pd.DataFrame, market: str) -> pd.DataFrame:
    """Add observation ids without dropping rows.

    Halifax rows that already carry `accountId` and `saleObservationId` keep
    those source ids. Processed Halifax and Vancouver extracts without a source
    key get a row fingerprint and an identity kind that says so.
    """
    enriched = frame.copy()
    empty = pd.Series([None] * len(enriched), index=enriched.index, dtype="object")

    if market == "halifax_maritimes" and "accountId" in enriched.columns and enriched["accountId"].map(canonical_token).ne("").any():
        if "saleObservationId" not in enriched.columns:
            raise ValueError("Halifax rows with accountId also need saleObservationId")
        enriched["sourceObservationId"] = enriched["saleObservationId"].map(canonical_token)
        enriched["accountId"] = enriched["accountId"].map(canonical_token)
        if "identityKind" not in enriched.columns:
            enriched["identityKind"] = "unverified_sale_observation"
        kind = enriched["identityKind"].map(canonical_token)
        if "crossSnapshotMatch" not in enriched.columns:
            enriched["crossSnapshotMatch"] = kind.map(_default_cross_snapshot_match)
        enriched["crossSnapshotMatch"] = _reconcile_cross_snapshot(kind, enriched["crossSnapshotMatch"])
        enriched["propertyObservationId"] = "halifax:sale:" + enriched["sourceObservationId"]
        return enriched

    if market == "halifax_maritimes":
        digest = fingerprint_frame(enriched, HALIFAX_PROCESSED_FINGERPRINT_COLUMNS)
        enriched["propertyObservationId"] = "halifax:processed-row:" + digest
        enriched["accountId"] = empty
        enriched["sourceObservationId"] = empty
        enriched["identityKind"] = "processed_row_fingerprint"
        enriched["crossSnapshotMatch"] = CROSS_SNAPSHOT_UNSUPPORTED
        return enriched

    if market == "vancouver":
        digest = fingerprint_frame(enriched, LISTING_FINGERPRINT_COLUMNS)
        enriched["propertyObservationId"] = "vancouver:listing-row:" + digest
        enriched["accountId"] = empty
        enriched["sourceObservationId"] = empty
        enriched["identityKind"] = "listing_row_fingerprint"
        enriched["crossSnapshotMatch"] = CROSS_SNAPSHOT_UNSUPPORTED
        return enriched

    raise ValueError(f"Unsupported market for identity assignment: {market}")


def duplicate_id_count(ids: pd.Series) -> int:
    return int(ids.duplicated().sum())
