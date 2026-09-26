import pandas as pd

from scripts.setup_halifax_data import classify_unmatched_sale_accounts, _zero_pad_match_delta


def _dwelling(**overrides) -> dict:
    row = {
        "aan": "1",
        "style": "2 Storey",
        "living_units": 1,
        "under_construction": "N",
    }
    row.update(overrides)
    return row


def test_unmatched_reasons_partition_without_dropping_accounts():
    window = pd.Series(["matched", "missing", "manufactured", "blank-style", "building", "units", "bug"])
    dwellings = pd.DataFrame(
        [
            _dwelling(aan="matched"),
            _dwelling(aan="manufactured", style="Manufactured Home"),
            _dwelling(aan="blank-style", style=None),
            _dwelling(aan="building", under_construction="Y"),
            _dwelling(aan="units", living_units=0),
            _dwelling(aan="bug"),
        ]
    )
    classified = classify_unmatched_sale_accounts(
        window,
        dwellings,
        pd.Series(["matched"]),
    )
    assert classified["reasons"] == {
        "noDwellingRow": 1,
        "eligibleRowNotJoined": 1,
        "styleUnmapped": 2,
        "underConstruction": 1,
        "livingUnitsOutside1To4": 1,
        "other": 0,
    }
    assert sum(classified["reasons"].values()) == classified["unmatchedAccounts"] == 6
    assert classified["styleUnmappedAccountStyles"]["Manufactured Home"] == 1
    assert classified["styleUnmappedAccountStyles"]["null"] == 1


def test_zero_pad_does_not_invent_matches_when_both_sides_are_integers():
    window = pd.Series(["12", "34"])
    eligible = pd.Series(["12"])
    assert _zero_pad_match_delta(window, eligible) == 0


def test_zero_pad_detects_a_real_formatting_mismatch():
    window = pd.Series(["00000012"])
    eligible = pd.Series(["12"])
    assert _zero_pad_match_delta(window, eligible) == 1
