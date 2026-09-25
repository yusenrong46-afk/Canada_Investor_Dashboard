"""Offline fixture tests for the release boundary. These are not a live-source rebuild."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.release_store import (
    LINEAGE_FIXTURE,
    LINEAGE_LEGACY,
    LINEAGE_RAW,
    ReleaseConflict,
    ReleaseRejected,
    content_sha256,
    content_sha256_bytes,
    open_candidate,
    publish_candidate,
    read_pointer,
    resolve_published_export,
    snapshot_record,
)
from scripts.build_all import BuildStep, run_build


def _passing_candidate(releases_root: Path, release_id: str):
    candidate = open_candidate(
        releases_root,
        lineage_class=LINEAGE_FIXTURE,
        raw_lineage_recovered=False,
        release_id=release_id,
        notes="offline fixture",
    )
    export = candidate.root / "exports" / "market_evidence.json"
    candidate.required_artifacts = ["exports/market_evidence.json"]
    candidate.begin_step("export", [export])
    export.write_text('{"status":"ok","release":"%s"}\n' % release_id, encoding="utf-8")
    error = candidate.complete_step("export", [export])
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
    assert pointer["validated"] is True
    assert pointer["role"] == "validated"
    assert pointer["lineageClass"] == LINEAGE_FIXTURE
    assert pointer["rawLineageRecovered"] is False
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
        release_id="fixture-rejected",
        raw_lineage_recovered=False,
    )
    export = rejected.root / "exports" / "market_evidence.json"
    rejected.required_artifacts = ["exports/market_evidence.json"]
    rejected.begin_step("export", [export])
    export.write_text('{"status":"bad"}\n', encoding="utf-8")
    assert rejected.complete_step("export", [export]) is None
    rejected.write_contracts(
        [{"name": "fixture.critical", "severity": "hard", "status": "fail", "observed": 0}]
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
