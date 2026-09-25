"""Offline fixture tests for the release boundary. These are not a live-source rebuild."""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pandas as pd
import pytest

from scripts.release_store import (
    LINEAGE_FIXTURE,
    LINEAGE_LEGACY,
    LINEAGE_RAW,
    ReleaseConflict,
    ReleaseError,
    ReleaseRejected,
    content_sha256,
    content_sha256_bytes,
    open_candidate,
    publish_candidate,
    read_pointer,
    reset_release_pin,
    resolve_published_export,
    snapshot_record,
)
from scripts.build_all import BuildStep, run_build


def _passing_candidate(releases_root: Path, release_id: str):
    candidate = open_candidate(
        releases_root,
        lineage_class=LINEAGE_FIXTURE,
        profile_id="offline_fixture",
        raw_lineage_recovered=False,
        release_id=release_id,
        notes="offline fixture",
    )
    export = candidate.root / "exports" / "market_evidence.json"
    candidate.begin_step("market evidence export", [export])
    export.write_text('{"status":"ok","release":"%s"}\n' % release_id, encoding="utf-8")
    error = candidate.complete_step("market evidence export", [export])
    assert error is None
    candidate.write_contracts(
        [{"name": "fixture.rows", "severity": "hard", "status": "pass", "observed": 1}]
    )
    return candidate


def test_successful_publication_selects_one_release(tmp_path: Path) -> None:
    releases = tmp_path / "repo" / "data" / "releases"
    candidate = _passing_candidate(releases, "fixture-success")
    published = publish_candidate(candidate)

    pointer = read_pointer(releases)
    assert pointer is not None
    assert pointer["releaseId"] == "fixture-success"
    assert pointer["validated"] is False
    assert pointer["productDataValidated"] is False
    assert pointer["dataChecksPassed"] is True
    assert pointer["role"] == "fixture"
    assert pointer["validationScope"] == "offline_fixture"
    assert pointer["lineageClass"] == LINEAGE_FIXTURE
    assert pointer["rawLineageRecovered"] is False
    assert pointer["markets"]["halifax_maritimes"] == "unavailable"
    assert published == releases / "published" / "fixture-success"
    resolved = resolve_published_export(tmp_path / "repo", "market_evidence.json")
    assert resolved == published / "exports" / "market_evidence.json"
    assert json.loads(resolved.read_text())["release"] == "fixture-success"
    manifest = json.loads((published / "manifest.json").read_text())
    assert manifest["artifacts"]["exports/market_evidence.json"]["buildId"] == candidate.build_id


def test_failed_validation_leaves_previous_release_unchanged(tmp_path: Path) -> None:
    releases = tmp_path / "repo" / "data" / "releases"
    first = _passing_candidate(releases, "fixture-kept")
    publish_candidate(first)
    kept = releases / "published" / "fixture-kept" / "exports" / "market_evidence.json"
    before = content_sha256(kept)
    pointer_before = read_pointer(releases)

    rejected = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        profile_id="offline_fixture",
        release_id="fixture-rejected",
        raw_lineage_recovered=False,
    )
    export = rejected.root / "exports" / "market_evidence.json"
    rejected.begin_step("market evidence export", [export])
    export.write_text('{"status":"bad"}\n', encoding="utf-8")
    assert rejected.complete_step("market evidence export", [export]) is None
    rejected.write_contracts(
        [{"name": "fixture.rows", "severity": "hard", "status": "fail", "observed": 0}]
    )

    with pytest.raises(ReleaseRejected):
        publish_candidate(rejected)

    assert content_sha256(kept) == before
    assert read_pointer(releases) == pointer_before
    assert not (releases / "published" / "fixture-rejected").exists()
    assert (releases / "candidates" / "fixture-rejected").is_dir()


def test_interrupted_candidate_is_not_selected(tmp_path: Path) -> None:
    releases = tmp_path / "data" / "releases"
    first = _passing_candidate(releases, "fixture-stable")
    publish_candidate(first)
    pointer_before = read_pointer(releases)

    crashed = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        release_id="fixture-crashed",
        raw_lineage_recovered=False,
    )
    partial = crashed.root / "exports" / "market_evidence.json.partial"
    partial.write_text("not a finished export", encoding="utf-8")
    crashed.mark_rejected("producer crashed before complete_step")

    with pytest.raises(ReleaseRejected):
        publish_candidate(crashed)

    assert read_pointer(releases) == pointer_before
    assert not (crashed.root / "exports" / "market_evidence.json").exists()
    assert partial.exists()


def test_stale_output_cannot_satisfy_the_current_build(tmp_path: Path) -> None:
    releases = tmp_path / "data" / "releases"
    candidate = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        release_id="fixture-stale",
        raw_lineage_recovered=False,
    )
    output = candidate.root / "exports" / "market_evidence.json"
    output.write_text('{"status":"old"}\n', encoding="utf-8")
    script = tmp_path / "leave_stale.py"
    script.write_text("print('did not rewrite the output')\n", encoding="utf-8")
    step = BuildStep(
        name="stale-export",
        script=script,
        outputs=(output,),
        required=True,
    )

    assert run_build([step], strict=True, candidate=candidate) == 1
    assert read_pointer(releases) is None
    assert "stale output" in candidate.manifest["rejectionReason"]


def test_publish_lock_rejects_a_second_writer(tmp_path: Path) -> None:
    releases = tmp_path / "data" / "releases"
    candidate = _passing_candidate(releases, "fixture-locked")
    lock = releases / ".publish.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_text("other-publisher\n", encoding="utf-8")

    with pytest.raises(ReleaseConflict):
        publish_candidate(candidate)

    assert lock.read_text() == "other-publisher\n"
    assert read_pointer(releases) is None


def test_same_bytes_keep_the_same_content_fingerprint() -> None:
    payload = b"listing-row-bytes"
    digest = content_sha256_bytes(payload)
    first = snapshot_record(
        name="vancouver",
        lineage_class=LINEAGE_RAW,
        content_sha256=digest,
        storage_ref="memory",
        fetched_at="2026-01-01T00:00:00+00:00",
    )
    second = snapshot_record(
        name="vancouver",
        lineage_class=LINEAGE_RAW,
        content_sha256=content_sha256_bytes(payload),
        storage_ref="memory",
        fetched_at="2026-06-01T00:00:00+00:00",
    )
    assert first["contentSha256"] == second["contentSha256"]
    assert first["ingestion"]["fetchedAt"] != second["ingestion"]["fetchedAt"]


def test_lineage_classes_stay_distinct(tmp_path: Path) -> None:
    releases = tmp_path / "data" / "releases"
    raw = open_candidate(releases, lineage_class=LINEAGE_RAW, release_id="raw-one", raw_lineage_recovered=True)
    legacy = open_candidate(releases, lineage_class=LINEAGE_LEGACY, release_id="legacy-one", raw_lineage_recovered=False)
    fixture = open_candidate(releases, lineage_class=LINEAGE_FIXTURE, release_id="fixture-one", raw_lineage_recovered=False)
    assert raw.lineage_class != legacy.lineage_class != fixture.lineage_class
    with pytest.raises(ValueError, match="cannot claim recovered raw lineage"):
        open_candidate(releases, lineage_class=LINEAGE_LEGACY, raw_lineage_recovered=True)


def test_empty_checks_cannot_become_a_validated_product_release(tmp_path: Path) -> None:
    releases = tmp_path / "releases"
    candidate = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        profile_id="offline_fixture",
        release_id="empty-contract",
        raw_lineage_recovered=False,
    )
    candidate.write_contracts([])

    with pytest.raises(ReleaseRejected, match="fixture.rows"):
        publish_candidate(candidate)

    assert read_pointer(releases) is None
    assert not (releases / "published" / "empty-contract").exists()
    reason = candidate.manifest["rejectionReason"]
    assert "market_evidence.json" in reason
    assert candidate.manifest.get("productDataValidated") is not True


def test_clearing_the_required_list_does_not_shrink_the_profile(tmp_path: Path) -> None:
    releases = tmp_path / "releases"
    candidate = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        profile_id="offline_fixture",
        release_id="short-list",
        raw_lineage_recovered=False,
    )
    candidate.required_artifacts = []
    candidate.manifest["requiredArtifacts"] = []
    candidate.write_contracts([])

    with pytest.raises(ReleaseRejected, match="market_evidence.json"):
        publish_candidate(candidate)

    assert read_pointer(releases) is None


def test_wrong_step_owner_and_checksum_mismatch_reject_publication(tmp_path: Path) -> None:
    releases = tmp_path / "releases"
    owned = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        profile_id="offline_fixture",
        release_id="wrong-owner",
        raw_lineage_recovered=False,
    )
    export = owned.root / "exports" / "market_evidence.json"
    owned.begin_step("export", [export])
    export.write_text('{"status":"ok"}\n', encoding="utf-8")
    assert owned.complete_step("export", [export]) is None
    owned.write_contracts([{"name": "fixture.rows", "severity": "hard", "status": "pass", "observed": 1}])

    with pytest.raises(ReleaseRejected, match="not market evidence export"):
        publish_candidate(owned)

    releases_b = tmp_path / "releases-b"
    mismatched = _passing_candidate(releases_b, "checksum")
    evidence = mismatched.root / "exports" / "market_evidence.json"
    evidence.write_text('{"status":"tampered"}\n', encoding="utf-8")
    with pytest.raises(ReleaseRejected, match="checksum mismatch"):
        publish_candidate(mismatched)
    assert read_pointer(releases_b) is None


def test_identical_rewrite_is_accepted_and_untouched_file_is_stale(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    releases = tmp_path / "releases"
    candidate = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        release_id="rewrite",
        raw_lineage_recovered=False,
    )
    output = candidate.root / "exports" / "market_evidence.json"
    payload = '{"same":true}\n'
    output.write_text(payload, encoding="utf-8")
    child = tmp_path / "rewrite.py"
    child.write_text(
        textwrap.dedent(
            """
            import os
            import sys
            from pathlib import Path

            sys.path.insert(0, os.environ["CVH_REPO"])
            from scripts.release_store import write_step_receipt

            path = Path(os.environ["CVH_OUT"])
            path.write_text(os.environ["CVH_PAYLOAD"], encoding="utf-8")
            write_step_receipt(outputs=["exports/market_evidence.json"])
            """
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CVH_REPO", str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("CVH_OUT", str(output))
    monkeypatch.setenv("CVH_PAYLOAD", payload)
    step = BuildStep(name="market evidence export", script=child, outputs=(output,), required=True)
    assert run_build([step], strict=True, candidate=candidate) == 0
    entry = candidate.manifest["artifacts"]["exports/market_evidence.json"]
    assert entry["contentUnchanged"] is True
    assert entry["sha256"] == content_sha256(output)

    untouched = tmp_path / "untouched.py"
    untouched.write_text("print('left the file alone')\n", encoding="utf-8")
    stale_output = candidate.root / "exports" / "market_map.json"
    stale_output.write_text('{"old":true}\n', encoding="utf-8")
    stale_step = BuildStep(name="market map export", script=untouched, outputs=(stale_output,), required=True)
    assert run_build([stale_step], strict=True, candidate=candidate) == 1
    assert "stale output" in candidate.manifest["rejectionReason"]


def test_declared_mutation_is_kept_and_undeclared_change_fails_seal(tmp_path: Path) -> None:
    releases = tmp_path / "releases"
    candidate = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        release_id="mutate",
        raw_lineage_recovered=False,
    )
    warehouse = candidate.root / "warehouse" / "property_analytics.duckdb"
    candidate.begin_step("analytics warehouse", [warehouse])
    warehouse.write_text("version-1", encoding="utf-8")
    assert candidate.complete_step("analytics warehouse", [warehouse]) is None

    candidate.begin_step("model experiment lab", [])
    warehouse.write_text("version-2", encoding="utf-8")
    assert candidate.complete_step(
        "model experiment lab",
        [],
        mutates=("warehouse/property_analytics.duckdb",),
    ) is None
    assert candidate.manifest["artifacts"]["warehouse/property_analytics.duckdb"]["mutationOwners"] == [
        "model experiment lab"
    ]
    candidate.reseal()

    warehouse.write_text("version-3", encoding="utf-8")
    with pytest.raises(ReleaseRejected, match="declared mutation owner"):
        candidate.reseal()


def test_subprocess_receipt_survives_later_steps_and_sealing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    releases = tmp_path / "releases"
    candidate = open_candidate(
        releases,
        lineage_class=LINEAGE_FIXTURE,
        release_id="receipt",
        raw_lineage_recovered=False,
    )
    csv_path = tmp_path / "rows.csv"
    pd.DataFrame({"a": [1]}).to_csv(csv_path, index=False)
    report = candidate.root / "reports" / "note.md"
    child = tmp_path / "child.py"
    child.write_text(
        textwrap.dedent(
            """
            import os
            import sys
            from pathlib import Path

            import pandas as pd

            sys.path.insert(0, os.environ["CVH_REPO"])
            from scripts.build_property_warehouse import _record_processed_snapshots

            csv_path = Path(os.environ["CVH_REPRO_CSV"])
            frame = pd.read_csv(csv_path)
            _record_processed_snapshots([("fixture_csv", csv_path, frame, "subprocess snapshot")])
            Path(os.environ["CVH_OUT"]).write_text("rewritten\\n", encoding="utf-8")
            manifest = Path(os.environ["CVH_CANDIDATE_ROOT"]) / "manifest.json"
            if b"subprocess snapshot" in manifest.read_bytes():
                raise SystemExit("child wrote the parent manifest")
            """
        ),
        encoding="utf-8",
    )
    later = tmp_path / "later.py"
    later_output = candidate.root / "reports" / "later.md"
    later.write_text(
        textwrap.dedent(
            """
            import os
            from pathlib import Path

            Path(os.environ["CVH_LATER_OUT"]).write_text("later\\n", encoding="utf-8")
            """
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CVH_REPO", str(Path(__file__).resolve().parents[1]))
    monkeypatch.setenv("CVH_REPRO_CSV", str(csv_path))
    monkeypatch.setenv("CVH_OUT", str(report))
    monkeypatch.setenv("CVH_LATER_OUT", str(later_output))

    first = BuildStep(name="analytics warehouse", script=child, outputs=(report,), required=True)
    second = BuildStep(name="data quality report", script=later, outputs=(later_output,), required=True)
    assert run_build([first, second], strict=True, candidate=candidate) == 0
    candidate.reseal()

    manifest = json.loads((candidate.root / "manifest.json").read_text(encoding="utf-8"))
    assert [row["name"] for row in manifest["snapshots"]] == ["fixture_csv"]
    assert manifest["snapshots"][0]["notes"] == "subprocess snapshot"
    assert manifest["completedSteps"] == ["analytics warehouse", "data quality report"]
    assert "reports/note.md" in manifest["artifacts"]
    assert "reports/later.md" in manifest["artifacts"]
    assert manifest["artifacts"]["reports/note.md"]["buildId"] == candidate.build_id


def test_reader_pins_one_release_until_reset(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    releases = repo / "data" / "releases"
    reset_release_pin()
    _publish_named(releases, "release-a", evidence="A-evidence", map_body="A-map")
    _publish_named(releases, "release-b", evidence="B-evidence", map_body="B-map")
    _select(releases, "release-a", role="fixture")

    evidence = resolve_published_export(repo, "market_evidence.json")
    market_map = resolve_published_export(repo, "market_map.json")
    assert evidence.read_text(encoding="utf-8") == "A-evidence"
    assert market_map.read_text(encoding="utf-8") == "A-map"

    _select(releases, "release-b", role="scoped_hrm_data")
    assert resolve_published_export(repo, "market_evidence.json").read_text(encoding="utf-8") == "A-evidence"
    assert resolve_published_export(repo, "market_map.json").read_text(encoding="utf-8") == "A-map"

    reset_release_pin()
    assert resolve_published_export(repo, "market_evidence.json").read_text(encoding="utf-8") == "B-evidence"
    assert resolve_published_export(repo, "market_map.json").read_text(encoding="utf-8") == "B-map"

    (releases / "published" / "release-b" / "exports" / "market_map.json").unlink()
    reset_release_pin()
    legacy_map = repo / "data" / "exports" / "market_map.json"
    legacy_map.parent.mkdir(parents=True, exist_ok=True)
    legacy_map.write_text("legacy-map", encoding="utf-8")
    (releases / "published" / "release-a" / "exports" / "market_map.json").write_text("A-map", encoding="utf-8")
    with pytest.raises(ReleaseError, match="do not fall back"):
        resolve_published_export(repo, "market_map.json")
    reset_release_pin()


def _publish_named(releases: Path, release_id: str, *, evidence: str, map_body: str) -> None:
    export_dir = releases / "published" / release_id / "exports"
    export_dir.mkdir(parents=True)
    (export_dir / "market_evidence.json").write_text(evidence, encoding="utf-8")
    (export_dir / "market_map.json").write_text(map_body, encoding="utf-8")


def _select(releases: Path, release_id: str, *, role: str) -> None:
    payload = {
        "releaseId": release_id,
        "relativePath": f"published/{release_id}",
        "validated": False,
        "role": role,
        "lineageClass": LINEAGE_FIXTURE,
        "rawLineageRecovered": False,
        "productDataValidated": False,
        "validationScope": role,
    }
    (releases / "current.json").write_text(json.dumps(payload), encoding="utf-8")
