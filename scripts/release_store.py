"""Immutable release directories and a single current-release pointer.

A candidate is built only under ``candidates/<id>``. Publication validates that
directory, renames it to ``published/<id>``, then replaces ``current.json``.
Readers follow that one pointer. A failed validation does not change the
pointer or previously published bytes.

Guarantees that are tested:
- candidate construction does not modify the selected release
- a hard contract failure rejects publication
- an incomplete step cannot satisfy publication via a pre-existing file
- two overlapping publish calls: the second is rejected while the lock exists

Not claimed: durability if the machine loses power during the directory rename
or the pointer replace. A rename that succeeds and a pointer write that fails
leaves the new directory unpublished; the previous pointer still selects the
previous release.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


LINEAGE_RAW = "raw_source_backed"
LINEAGE_LEGACY = "legacy_processed_snapshot"
LINEAGE_FIXTURE = "offline_fixture"
LINEAGE_CLASSES = {LINEAGE_RAW, LINEAGE_LEGACY, LINEAGE_FIXTURE}

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RELEASES_ROOT = REPO_ROOT / "data" / "releases"


class ReleaseError(RuntimeError):
    pass


class ReleaseRejected(ReleaseError):
    pass


class ReleaseConflict(ReleaseError):
    pass


def content_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def content_sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def snapshot_record(
    *,
    name: str,
    lineage_class: str,
    content_sha256: str,
    storage_ref: str,
    row_count: int | None = None,
    schema: list[str] | None = None,
    source_identity: str | None = None,
    retrieval_filters: str | None = None,
    fetched_at: str | None = None,
    source_observation_period: str | None = None,
    source_updated_at: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Content identity is the byte hash. Retrieval time is event metadata."""
    if lineage_class not in LINEAGE_CLASSES:
        raise ValueError(f"Unknown lineage class: {lineage_class}")
    return {
        "name": name,
        "lineageClass": lineage_class,
        "contentSha256": content_sha256,
        "storageRef": storage_ref,
        "rowCount": row_count,
        "schema": schema or [],
        "sourceIdentity": source_identity,
        "retrievalFilters": retrieval_filters,
        "sourceObservationPeriod": source_observation_period,
        "ingestion": {
            "fetchedAt": fetched_at,
            "sourceUpdatedAt": source_updated_at,
        },
        "notes": notes,
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(partial, path)


@dataclass
class CandidateBuild:
    releases_root: Path
    root: Path
    release_id: str
    build_id: str
    lineage_class: str
    reference_date: str | None
    raw_lineage_recovered: bool
    manifest: dict[str, Any]
    required_artifacts: list[str] = field(default_factory=list)
    _pre_hashes: dict[str, dict[str, str | None]] = field(default_factory=dict)

    @property
    def manifest_path(self) -> Path:
        return self.root / "manifest.json"

    def _save(self) -> None:
        _write_json(self.manifest_path, self.manifest)

    def begin_step(self, step_name: str, outputs: list[Path]) -> None:
        recorded: dict[str, str | None] = {}
        for path in outputs:
            recorded[str(path.resolve())] = content_sha256(path) if path.is_file() else None
        self._pre_hashes[step_name] = recorded

    def complete_step(self, step_name: str, outputs: list[Path]) -> str | None:
        """Record outputs written by this step. Unchanged pre-existing files are stale."""
        pre = self._pre_hashes.get(step_name)
        if pre is None:
            return f"step {step_name} was not started"
        artifacts = self.manifest.setdefault("artifacts", {})
        for path in outputs:
            resolved = path.resolve()
            key = str(resolved)
            if not path.is_file():
                return f"step {step_name} did not produce {path}"
            digest = content_sha256(path)
            if pre.get(key) is not None and pre.get(key) == digest:
                return f"stale output was not rewritten by {step_name}: {path.name}"
            relative = path.resolve().relative_to(self.root.resolve()).as_posix()
            artifacts[relative] = {
                "sha256": digest,
                "bytes": path.stat().st_size,
                "producedByStep": step_name,
                "buildId": self.build_id,
            }
        completed = self.manifest.setdefault("completedSteps", [])
        if step_name not in completed:
            completed.append(step_name)
        self._save()
        return None

    def reseal(self) -> None:
        """Recompute checksums after later steps legally rewrite an earlier artifact."""
        artifacts = self.manifest.get("artifacts", {})
        for relative, entry in artifacts.items():
            path = self.root / relative
            if not path.is_file():
                raise ReleaseRejected(f"sealed artifact disappeared: {relative}")
            entry["sha256"] = content_sha256(path)
            entry["bytes"] = path.stat().st_size
        self._save()

    def write_contracts(self, checks: list[dict[str, Any]]) -> None:
        path = self.root / "contracts.json"
        self.begin_step("contracts", [path])
        _write_json(path, {"checks": checks})
        error = self.complete_step("contracts", [path])
        if error:
            raise ReleaseError(error)

    def add_snapshot(self, record: dict[str, Any]) -> None:
        self.manifest.setdefault("snapshots", []).append(record)
        self._save()

    def mark_rejected(self, reason: str) -> None:
        self.manifest["status"] = "rejected"
        self.manifest["rejectionReason"] = reason
        self._save()


def open_candidate(
    releases_root: Path = DEFAULT_RELEASES_ROOT,
    *,
    lineage_class: str,
    reference_date: str | None = None,
    release_id: str | None = None,
    raw_lineage_recovered: bool = False,
    notes: str | None = None,
) -> CandidateBuild:
    if lineage_class not in LINEAGE_CLASSES:
        raise ValueError(f"Unknown lineage class: {lineage_class}")
    if lineage_class == LINEAGE_LEGACY and raw_lineage_recovered:
        raise ValueError("A legacy processed snapshot cannot claim recovered raw lineage")
    build_id = uuid.uuid4().hex
    chosen_id = release_id or f"candidate-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{build_id[:8]}"
    root = releases_root / "candidates" / chosen_id
    if root.exists():
        raise ReleaseError(f"Candidate already exists: {root}")
    (root / "exports").mkdir(parents=True)
    (root / "reports").mkdir(parents=True)
    (root / "warehouse").mkdir(parents=True)
    manifest = {
        "releaseId": chosen_id,
        "buildId": build_id,
        "lineageClass": lineage_class,
        "status": "building",
        "referenceDate": reference_date,
        "rawLineageRecovered": raw_lineage_recovered,
        "createdAt": _utc_now(),
        "notes": notes,
        "artifacts": {},
        "completedSteps": [],
        "snapshots": [],
        "requiredArtifacts": [],
    }
    candidate = CandidateBuild(
        releases_root=releases_root,
        root=root,
        release_id=chosen_id,
        build_id=build_id,
        lineage_class=lineage_class,
        reference_date=reference_date,
        raw_lineage_recovered=raw_lineage_recovered,
        manifest=manifest,
    )
    candidate._save()
    return candidate


def _lock_path(releases_root: Path) -> Path:
    return releases_root / ".publish.lock"


def _acquire_lock(releases_root: Path) -> Path:
    releases_root.mkdir(parents=True, exist_ok=True)
    path = _lock_path(releases_root)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    try:
        fd = os.open(path, flags, 0o644)
    except FileExistsError as error:
        raise ReleaseConflict(
            f"Publish rejected because {path} already exists. "
            "This milestone allows one publisher at a time and does not steal a lock."
        ) from error
    try:
        os.write(fd, f"{os.getpid()}\n".encode())
    finally:
        os.close(fd)
    return path


def _release_lock(path: Path) -> None:
    path.unlink(missing_ok=True)


def _hard_contract_failures(candidate: CandidateBuild) -> list[str]:
    path = candidate.root / "contracts.json"
    if not path.is_file():
        return ["contracts.json was not written by this build"]
    payload = json.loads(path.read_text(encoding="utf-8"))
    failures = []
    for check in payload.get("checks", []):
        if check.get("severity") == "hard" and check.get("status") != "pass":
            failures.append(
                f"{check.get('name')}: status={check.get('status')} observed={check.get('observed')}"
            )
    return failures


def _validate_candidate(candidate: CandidateBuild) -> None:
    if candidate.manifest.get("status") == "rejected":
        raise ReleaseRejected(candidate.manifest.get("rejectionReason") or "candidate was rejected")
    if candidate.lineage_class == LINEAGE_LEGACY and candidate.raw_lineage_recovered:
        raise ReleaseRejected("legacy processed snapshot claims recovered raw lineage")
    failures = _hard_contract_failures(candidate)
    required = list(candidate.required_artifacts or candidate.manifest.get("requiredArtifacts") or [])
    artifacts = candidate.manifest.get("artifacts", {})
    if not artifacts:
        failures.append("candidate recorded no artifacts")
    for relative in required:
        entry = artifacts.get(relative)
        if entry is None:
            failures.append(f"required artifact was not produced by this build: {relative}")
            continue
        if entry.get("buildId") != candidate.build_id:
            failures.append(f"required artifact {relative} belongs to a different build")
        path = candidate.root / relative
        if not path.is_file():
            failures.append(f"required artifact missing on disk: {relative}")
            continue
        if content_sha256(path) != entry.get("sha256"):
            failures.append(f"checksum mismatch for {relative}")
    if failures:
        raise ReleaseRejected("; ".join(failures))


def _write_pointer(
    releases_root: Path,
    *,
    release_id: str,
    validated: bool,
    role: str,
    lineage_class: str,
    raw_lineage_recovered: bool,
) -> None:
    payload = {
        "releaseId": release_id,
        "relativePath": f"published/{release_id}",
        "validated": validated,
        "role": role,
        "lineageClass": lineage_class,
        "rawLineageRecovered": raw_lineage_recovered,
        "selectedAt": _utc_now(),
    }
    _write_json(releases_root / "current.json", payload)


def publish_candidate(candidate: CandidateBuild) -> Path:
    """Validate and switch the pointer. Rejects hard contract failures."""
    lock = _acquire_lock(candidate.releases_root)
    moved = False
    destination = candidate.releases_root / "published" / candidate.release_id
    try:
        _validate_candidate(candidate)
        if destination.exists():
            raise ReleaseRejected(f"Release id already exists: {destination.name}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        candidate.manifest["status"] = "published"
        candidate.manifest["publishedAt"] = _utc_now()
        candidate._save()
        os.rename(candidate.root, destination)
        moved = True
        candidate.root = destination
        _write_pointer(
            candidate.releases_root,
            release_id=candidate.release_id,
            validated=True,
            role="validated",
            lineage_class=candidate.lineage_class,
            raw_lineage_recovered=candidate.raw_lineage_recovered,
        )
        return destination
    except Exception:
        if not moved:
            candidate.mark_rejected("publication rejected")
        raise
    finally:
        _release_lock(lock)


def read_pointer(releases_root: Path = DEFAULT_RELEASES_ROOT) -> dict[str, Any] | None:
    path = releases_root / "current.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def selected_release_dir(releases_root: Path = DEFAULT_RELEASES_ROOT) -> Path | None:
    pointer = read_pointer(releases_root)
    if pointer is None:
        return None
    return releases_root / pointer["relativePath"]


def resolve_published_export(repo_root: Path, filename: str) -> Path:
    """Resolve one export from the selected release.

    If no pointer exists, the legacy ``data/exports`` path is used. When a
    pointer exists, this never falls back to a different directory.
    """
    pointer_path = repo_root / "data" / "releases" / "current.json"
    legacy = repo_root / "data" / "exports" / filename
    if not pointer_path.is_file():
        return legacy
    pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    relative = pointer.get("relativePath")
    if not relative:
        raise ReleaseError("current.json is missing relativePath")
    return repo_root / "data" / "releases" / relative / "exports" / filename


def install_retained_release(
    releases_root: Path,
    release_id: str,
    *,
    source_dir: Path,
    manifest: dict[str, Any],
) -> Path:
    """Point current.json at a prepared legacy directory.

    This is not validation. ``validated`` stays false. The directory must
    already contain its exports. The pointer is the only switch.
    """
    if manifest.get("lineageClass") != LINEAGE_LEGACY:
        raise ReleaseError("retain is only for legacy processed snapshots")
    if manifest.get("rawLineageRecovered"):
        raise ReleaseError("retained legacy release cannot claim raw lineage")
    destination = releases_root / "published" / release_id
    if not destination.is_dir():
        raise ReleaseError(f"Retained release directory does not exist: {destination}")
    if source_dir.resolve() != destination.resolve():
        raise ReleaseError("source_dir must already be the published legacy directory")
    manifest = {
        **manifest,
        "releaseId": release_id,
        "status": "retained_legacy",
        "validated": False,
        "rawLineageRecovered": False,
    }
    lock = _acquire_lock(releases_root)
    try:
        _write_json(destination / "manifest.json", manifest)
        _write_pointer(
            releases_root,
            release_id=release_id,
            validated=False,
            role="retained_legacy",
            lineage_class=LINEAGE_LEGACY,
            raw_lineage_recovered=False,
        )
    finally:
        _release_lock(lock)
    return destination
