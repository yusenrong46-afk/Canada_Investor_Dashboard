"""HRM publication scope. Fixture audits are not the live snapshot measurement."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from scripts.build_property_warehouse import _join_contract, _sale_identity_contract
from scripts.release_store import LINEAGE_RAW, ReleaseRejected, open_candidate, publish_candidate, read_pointer
from scripts.build_hrm_candidate import PRODUCT_RELEASES


def test_missing_join_audit_does_not_invent_a_rate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CVH_JOIN_AUDIT_PATH", raising=False)
    check = _join_contract()
    assert check["status"] == "not_applicable"
    assert check["threshold"] == 0.90
    assert check["observed"] is None


def test_join_audit_keeps_the_threshold_and_denominator(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    audit = {
        "inputCapability": "raw_sales_and_dwellings",
        "remeasured": True,
        "measuredRate": 0.89,
        "numerator": 89,
        "numeratorName": "matched",
        "denominator": 100,
        "denominatorName": "latest_sale_per_aan_on_or_after_training_window_start",
        "unmatchedAccounts": 11,
    }
    path = tmp_path / "join_audit.json"
    path.write_text(json.dumps(audit), encoding="utf-8")
    monkeypatch.setenv("CVH_JOIN_AUDIT_PATH", str(path))
    failed = _join_contract()
    assert failed["status"] == "fail"
    assert failed["threshold"] == 0.90
    assert failed["denominatorName"] == "latest_sale_per_aan_on_or_after_training_window_start"

    audit["measuredRate"] = 0.90
    audit["numerator"] = 90
    audit["unmatchedAccounts"] = 10
    path.write_text(json.dumps(audit), encoding="utf-8")
    passed = _join_contract()
    assert passed["status"] == "pass"
    assert passed["observed"] == 0.90


def test_sale_identity_pass_does_not_mean_cross_snapshot_support() -> None:
    frame = pd.DataFrame(
        {
            "identityKind": ["snapshot_observation:aan|sale_date|sale_price"],
            "crossSnapshotMatch": ["unsupported"],
        }
    )
    check = _sale_identity_contract(frame)
    assert check["status"] == "pass"
    assert check["observed"] == "unsupported"

    overclaimed = frame.copy()
    overclaimed["crossSnapshotMatch"] = "supported"
    assert _sale_identity_contract(overclaimed)["status"] == "fail"

    price_correction = pd.DataFrame(
        {
            "identityKind": ["snapshot_observation:aan|sale_date"],
            "crossSnapshotMatch": ["price_correction"],
        }
    )
    assert _sale_identity_contract(price_correction)["status"] == "pass"
    assert _sale_identity_contract(price_correction)["observed"] == "price_correction"


def test_hrm_profile_rejects_an_unmeasured_join(tmp_path: Path) -> None:
    releases = tmp_path / "releases"
    candidate = open_candidate(
        releases,
        lineage_class=LINEAGE_RAW,
        profile_id="hrm_raw_evidence",
        release_id="hrm-unmeasured",
        raw_lineage_recovered=True,
    )
    for relative, step in (
        ("warehouse/property_analytics.duckdb", "analytics warehouse"),
        ("reports/analytics_warehouse_report.md", "analytics warehouse"),
        ("exports/market_evidence.json", "market evidence export"),
    ):
        path = candidate.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        candidate.begin_step(step, [path])
        path.write_text("placeholder\n", encoding="utf-8")
        assert candidate.complete_step(step, [path]) is None
    candidate.write_contracts(
        [
            {"name": "halifax_maritimes.observation_id_present", "severity": "hard", "status": "pass", "observed": 0},
            {"name": "halifax_maritimes.observation_id_unique", "severity": "hard", "status": "pass", "observed": 0},
            {
                "name": "halifax_maritimes.sale_to_dwelling_join",
                "severity": "hard",
                "status": "not_applicable",
                "observed": None,
            },
            {
                "name": "halifax_maritimes.sale_identity",
                "severity": "hard",
                "status": "pass",
                "observed": "unsupported",
            },
        ]
    )
    with pytest.raises(ReleaseRejected, match="sale_to_dwelling_join"):
        publish_candidate(candidate)
    assert read_pointer(releases) is None


def test_hrm_builder_refuses_the_product_release_root() -> None:
    assert PRODUCT_RELEASES.name == "releases"
