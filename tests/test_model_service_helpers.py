from __future__ import annotations

import sys
from pathlib import Path

MODEL_SERVICE_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from service import _normalize_postal_code, _normalize_property_type, _parse_numeric  # noqa: E402


def test_normalize_postal_code_accepts_vancouver_format() -> None:
    assert _normalize_postal_code("v6b 1x9") == "V6B1X9"


def test_normalize_postal_code_rejects_invalid_values() -> None:
    assert _normalize_postal_code("not a postal code") is None


def test_normalize_property_type_maps_common_listing_words() -> None:
    assert _normalize_property_type("Single Family", "") == "Detached"
    assert _normalize_property_type("", "Apartment/Condo") == "Condo"
    assert _normalize_property_type("", "Townhouse") == "Townhouse"
    assert _normalize_property_type("", "Duplex") == "Duplex"


def test_parse_numeric_handles_listing_style_strings() -> None:
    assert _parse_numeric("$1,250,000") == 1_250_000
    assert _parse_numeric("708 sqft") == 708
    assert _parse_numeric("") is None
