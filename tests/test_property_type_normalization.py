import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "artifacts" / "model-service"))

from base_model.core import normalize_property_type  # noqa: E402


def test_condo_and_apartment_inputs_normalize_to_condo():
    assert normalize_property_type("Condo") == "Condo"
    assert normalize_property_type("Apartment") == "Condo"
    assert normalize_property_type("Condo Apartment") == "Condo"


def test_other_common_property_types_normalize_cleanly():
    assert normalize_property_type("Single Family House") == "Detached"
    assert normalize_property_type("Townhome") == "Townhouse"
    assert normalize_property_type("Duplex") == "Duplex"
