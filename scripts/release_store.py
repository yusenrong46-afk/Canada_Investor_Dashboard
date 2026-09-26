"""Immutable release directories and a single current-release pointer.

A candidate is built only under ``candidates/<id>``. Publication validates that
directory, renames it to ``published/<id>``, then replaces ``current.json``.
Readers follow that one pointer. A failed validation does not change the
pointer or previously published bytes.

Guarantees that are tested:
- candidate construction does not modify the selected release
- publication follows an explicit profile: empty checks or a missing required
  artifact cannot become a validated product release
- a fixture publication does not claim validated production data
- an incomplete step cannot satisfy publication via a pre-existing file
- a subprocess receipt is merged by the parent, so later saves keep snapshots
- two overlapping publish calls: the second is rejected while the lock exists
- a process pins one release until restart

Not a product-wide validation claim: ``validated`` on the pointer stays false.
``dataChecksPassed`` means only that the selected profile's checks passed.

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

from scripts.release_profile import CONSUMER_EXPORTS, get_profile


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
    _pre_hashes: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    _checks: dict[str, dict[str, Any]] = field(default_factory=dict)
    _receipt_outputs: set[str] = field(default_factory=set)

    @property
    def manifest_path(self) -> Path:
        return self.root / "manifest.json"

    def _save(self) -> None:
        _write_json(self.manifest_path, self.manifest)

    def begin_step(self, step_name: str, outputs: list[Path]) -> None:
        recorded: dict[str, dict[str, Any]] = {}
        for path in outputs:
            if path.is_file():
                stat = path.stat()
                recorded[str(path.resolve())] = {
                    "sha256": content_sha256(path),
                    "mtime_ns": stat.st_mtime_ns,
                }
            else:
                recorded[str(path.resolve())] = {"sha256": None, "mtime_ns": None}
        self._pre_hashes[step_name] = recorded

    def complete_step(
        self,
        step_name: str,
        outputs: list[Path],
        mutates: tuple[str, ...] | list[str] = (),
    ) -> str | None:
        """Record outputs written by this step.

        An existing file with the same bytes is stale unless this step's receipt
        names it or the file mtime moved. Declared ``mutates`` paths may change shared
        outputs such as the warehouse; unexplained checksum changes are not
        adopted here.
        """
        pre = self._pre_hashes.get(step_name)
        if pre is None:
            return f"step {step_name} was not started"
        artifacts = self.manifest.setdefault("artifacts", {})
        unavailable = self.manifest.setdefault("unavailableArtifacts", {})
        for path in outputs:
            resolved = path.resolve()
            key = str(resolved)
            if not path.is_file():
                return f"step {step_name} did not produce {path}"
            digest = content_sha256(path)
            stat = path.stat()
            prior = pre.get(key) or {"sha256": None, "mtime_ns": None}
            content_unchanged = False
            relative = resolved.relative_to(self.root.resolve()).as_posix()
            if prior.get("sha256") is not None and prior.get("sha256") == digest:
                mtime_moved = prior.get("mtime_ns") != stat.st_mtime_ns
                claimed = relative in self._receipt_outputs
                if not mtime_moved and not claimed:
                    return f"stale output was not rewritten by {step_name}: {path.name}"
                content_unchanged = True
            artifacts[relative] = {
                "sha256": digest,
                "bytes": stat.st_size,
                "producedByStep": step_name,
                "buildId": self.build_id,
                "contentUnchanged": content_unchanged,
            }
            unavailable.pop(relative, None)
        for relative in mutates:
            mutation_error = self._record_mutation(step_name, relative, artifacts)
            if mutation_error:
                return mutation_error
        completed = self.manifest.setdefault("completedSteps", [])
        if step_name not in completed:
            completed.append(step_name)
        self._receipt_outputs.clear()
        self._save()
        return None

    def _record_mutation(self, step_name: str, relative: str, artifacts: dict[str, Any]) -> str | None:
        path = self.root / relative
        if not path.is_file():
            return f"declared mutation target missing after {step_name}: {relative}"
        entry = artifacts.get(relative)
        if entry is None:
            return f"declared mutation {relative} has no artifact record from an earlier step"
        if entry.get("buildId") != self.build_id:
            return f"declared mutation {relative} belongs to a different build"
        owners = list(entry.get("mutationOwners") or [])
        if step_name not in owners:
            owners.append(step_name)
        entry["sha256"] = content_sha256(path)
        entry["bytes"] = path.stat().st_size
        entry["mutationOwners"] = owners
        artifacts[relative] = entry
        return None

    def reseal(self) -> None:
        """Verify recorded checksums. Do not adopt unexplained byte changes."""
        artifacts = self.manifest.get("artifacts", {})
        problems: list[str] = []
        for relative, entry in artifacts.items():
            path = self.root / relative
            if not path.is_file():
                problems.append(f"sealed artifact disappeared: {relative}")
                continue
            digest = content_sha256(path)
            if digest != entry.get("sha256"):
                problems.append(f"artifact {relative} changed without a declared mutation owner")
        if problems:
            raise ReleaseRejected("; ".join(problems))
        self.manifest["sealedAt"] = _utc_now()
        self._save()

    def merge_receipt(self, receipt_path: Path) -> str | None:
        """Merge a subprocess receipt into the in-memory manifest.

        The child must not write ``manifest.json``. The parent owns that file.
        """
        if not receipt_path.is_file():
            return None
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("buildId") != self.build_id:
            return f"receipt {receipt_path.name} belongs to build {receipt.get('buildId')}, not {self.build_id}"
        snapshots = receipt.get("snapshots") or []
        if not isinstance(snapshots, list):
            return f"receipt {receipt_path.name} snapshots must be a list"
        self.manifest.setdefault("snapshots", []).extend(snapshots)
        for check in receipt.get("checks") or []:
            name = check.get("name") if isinstance(check, dict) else None
            if not name:
                return f"receipt {receipt_path.name} contains a check without a name"
            if name in self._checks:
                return f"duplicate check {name} in receipt {receipt_path.name}"
            self._checks[name] = check
        for relative in receipt.get("outputs") or []:
            if not isinstance(relative, str) or not relative:
                return f"receipt {receipt_path.name} has an invalid output path"
            self._receipt_outputs.add(relative)
        self._save()
        return None

    def collected_checks(self) -> list[dict[str, Any]]:
        return list(self._checks.values())

    def write_contracts(self, checks: list[dict[str, Any]]) -> None:
        path = self.root / "contracts.json"
        self.begin_step("contracts", [path])
        _write_json(path, {"checks": checks})
        self._receipt_outputs.add("contracts.json")
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


def write_step_receipt(
    *,
    snapshots: list[dict[str, Any]] | None = None,
    checks: list[dict[str, Any]] | None = None,
    outputs: list[str] | None = None,
) -> None:
    """Write a receipt for the parent to merge. Never edits manifest.json.

    ``outputs`` are candidate-relative paths this step rewrote. The parent
    accepts an identical-byte rewrite only when the receipt names that path
    or the file mtime moved. An untouched file is still stale.
    """
    raw_path = os.environ.get("CVH_RECEIPT_PATH")
    if not raw_path:
        return
    build_id = os.environ.get("CVH_BUILD_ID")
    if not build_id:
        raise ReleaseError("CVH_RECEIPT_PATH is set without CVH_BUILD_ID")
    _write_json(
        Path(raw_path),
        {
            "buildId": build_id,
            "snapshots": snapshots or [],
            "checks": checks or [],
            "outputs": outputs or [],
        },
    )


def open_candidate(
    releases_root: Path = DEFAULT_RELEASES_ROOT,
    *,
    lineage_class: str,
    reference_date: str | None = None,
    release_id: str | None = None,
    raw_lineage_recovered: bool = False,
    notes: str | None = None,
    profile_id: str | None = None,
) -> CandidateBuild:
    if lineage_class not in LINEAGE_CLASSES:
        raise ValueError(f"Unknown lineage class: {lineage_class}")
    if lineage_class == LINEAGE_LEGACY and raw_lineage_recovered:
        raise ValueError("A legacy processed snapshot cannot claim recovered raw lineage")
    profile = None
    if profile_id is not None:
        try:
            profile = get_profile(profile_id)
        except KeyError as error:
            raise ValueError(str(error)) from error
        if profile.lineage_class != lineage_class:
            raise ValueError(
                f"Profile {profile.profile_id} requires lineage {profile.lineage_class}, not {lineage_class}"
            )
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
        "requiredChecks": [],
        "profileId": profile_id,
        "productDataValidated": False,
        "unavailableArtifacts": {},
    }
    if profile is not None:
        manifest["role"] = profile.role
        manifest["validationScope"] = profile.validation_scope
        manifest["markets"] = dict(profile.markets)
        manifest["requiredArtifacts"] = [item.relative_path for item in profile.required_artifacts]
        manifest["requiredChecks"] = list(profile.required_checks)
        manifest["artifactOwners"] = {
            item.relative_path: item.produced_by_step for item in profile.required_artifacts
        }
        manifest["modelLimitations"] = list(profile.model_limitations)
        required_paths = set(manifest["requiredArtifacts"])
        for relative in CONSUMER_EXPORTS:
            if relative not in required_paths:
                manifest["unavailableArtifacts"][relative] = {
                    "status": "unavailable",
                    "reason": f"Profile {profile.profile_id} does not produce this export.",
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
        required_artifacts=list(manifest["requiredArtifacts"]),
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


def _load_checks(candidate: CandidateBuild) -> tuple[list[dict[str, Any]], list[str]]:
    path = candidate.root / "contracts.json"
    if not path.is_file():
        return [], ["contracts.json was not written by this build"]
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return [], ["contracts.json is not valid json"]
    checks = payload.get("checks")
    if not isinstance(checks, list):
        return [], ["contracts.json checks must be a list"]
    failures: list[str] = []
    seen: set[str] = set()
    for check in checks:
        if not isinstance(check, dict) or not check.get("name"):
            failures.append("contracts.json contains a check without a name")
            continue
        name = str(check["name"])
        if name in seen:
            failures.append(f"duplicate check name: {name}")
        seen.add(name)
        if check.get("severity") == "hard" and check.get("status") != "pass":
            failures.append(f"{name}: status={check.get('status')} observed={check.get('observed')}")
    return checks, failures


def _validate_candidate(candidate: CandidateBuild) -> None:
    if candidate.manifest.get("status") == "rejected":
        raise ReleaseRejected(candidate.manifest.get("rejectionReason") or "candidate was rejected")
    if candidate.lineage_class == LINEAGE_LEGACY and candidate.raw_lineage_recovered:
        raise ReleaseRejected("legacy processed snapshot claims recovered raw lineage")
    if candidate.manifest.get("productDataValidated") is True:
        raise ReleaseRejected("productDataValidated cannot be claimed by this release")

    profile_id = candidate.manifest.get("profileId")
    if not profile_id:
        raise ReleaseRejected("publication requires an explicit release profile")
    try:
        profile = get_profile(str(profile_id))
    except KeyError as error:
        raise ReleaseRejected(str(error)) from error
    if profile.role == "retained_legacy" or profile.lineage_class == LINEAGE_LEGACY:
        raise ReleaseRejected(
            "A legacy processed snapshot stays unvalidated. "
            "Install it with install_retained_release; do not publish it as checked data."
        )
    if profile.lineage_class != candidate.lineage_class:
        raise ReleaseRejected(
            f"Profile {profile.profile_id} does not match lineage {candidate.lineage_class}"
        )

    checks, failures = _load_checks(candidate)
    by_name = {str(check.get("name")): check for check in checks if isinstance(check, dict) and check.get("name")}
    for name in profile.required_checks:
        check = by_name.get(name)
        if check is None:
            failures.append(f"required check {name} is missing")
            continue
        if check.get("status") != "pass":
            failures.append(
                f"required check {name}: status={check.get('status')} does not pass"
            )
        if check.get("severity") != "hard":
            failures.append(f"required check {name} must be severity hard")

    artifacts = candidate.manifest.get("artifacts", {})
    owners = {
        item.relative_path: item.produced_by_step for item in profile.required_artifacts
    }
    for relative, entry in artifacts.items():
        path = candidate.root / relative
        if not path.is_file():
            failures.append(f"recorded artifact missing on disk: {relative}")
            continue
        if content_sha256(path) != entry.get("sha256"):
            failures.append(f"checksum mismatch for {relative}")
        if entry.get("buildId") != candidate.build_id:
            failures.append(f"artifact {relative} belongs to a different build")
    for relative, owner in owners.items():
        entry = artifacts.get(relative)
        if entry is None:
            failures.append(f"required artifact was not produced by this build: {relative}")
            continue
        if entry.get("producedByStep") != owner:
            failures.append(
                f"required artifact {relative} was produced by {entry.get('producedByStep')}, not {owner}"
            )

    unavailable = candidate.manifest.get("unavailableArtifacts") or {}
    for relative in CONSUMER_EXPORTS:
        recorded = relative in artifacts
        marked = unavailable.get(relative)
        on_disk = (candidate.root / relative).is_file()
        if recorded and marked:
            failures.append(f"{relative} is both produced and marked unavailable")
        elif recorded:
            continue
        elif isinstance(marked, dict) and marked.get("status") == "unavailable" and marked.get("reason"):
            if on_disk:
                failures.append(f"{relative} is marked unavailable but a file is present in this release")
        else:
            failures.append(f"{relative} is neither produced by this release nor explicitly unavailable")

    if failures:
        raise ReleaseRejected("; ".join(failures))


def _write_pointer(
    releases_root: Path,
    *,
    release_id: str,
    role: str,
    lineage_class: str,
    raw_lineage_recovered: bool,
    profile_id: str,
    validation_scope: str,
    data_checks_passed: bool,
    markets: dict[str, str],
) -> None:
    """``validated`` stays false. It is not a product-wide data claim."""
    payload = {
        "releaseId": release_id,
        "relativePath": f"published/{release_id}",
        "validated": False,
        "role": role,
        "lineageClass": lineage_class,
        "rawLineageRecovered": raw_lineage_recovered,
        "profileId": profile_id,
        "validationScope": validation_scope,
        "productDataValidated": False,
        "dataChecksPassed": data_checks_passed,
        "markets": markets,
        "selectedAt": _utc_now(),
    }
    _write_json(releases_root / "current.json", payload)


def publish_candidate(candidate: CandidateBuild) -> Path:
    """Validate against the candidate profile and switch the pointer.

    A successful fixture publication sets ``dataChecksPassed`` and role
    ``fixture``. It does not set ``validated`` or ``productDataValidated``.
    """
    lock = _acquire_lock(candidate.releases_root)
    moved = False
    destination = candidate.releases_root / "published" / candidate.release_id
    try:
        _validate_candidate(candidate)
        profile = get_profile(str(candidate.manifest["profileId"]))
        if destination.exists():
            raise ReleaseRejected(f"Release id already exists: {destination.name}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        candidate.manifest["status"] = "published"
        candidate.manifest["publishedAt"] = _utc_now()
        candidate.manifest["productDataValidated"] = False
        candidate.manifest["dataChecksPassed"] = True
        candidate._save()
        os.rename(candidate.root, destination)
        moved = True
        candidate.root = destination
        _write_pointer(
            candidate.releases_root,
            release_id=candidate.release_id,
            role=profile.role,
            lineage_class=candidate.lineage_class,
            raw_lineage_recovered=candidate.raw_lineage_recovered,
            profile_id=profile.profile_id,
            validation_scope=profile.validation_scope,
            data_checks_passed=True,
            markets=dict(profile.markets),
        )
        return destination
    except ReleaseRejected as error:
        if not moved:
            candidate.mark_rejected(str(error))
        raise
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


_PROCESS_PIN: dict[str, dict[str, Any] | None] = {}


def reset_release_pin() -> None:
    """Test hook. A running server keeps the pin until the process restarts."""
    _PROCESS_PIN.clear()


def pinned_pointer(repo_root: Path) -> dict[str, Any] | None:
    """Read current.json once per process and repository root."""
    key = str(repo_root.resolve())
    if key in _PROCESS_PIN:
        return _PROCESS_PIN[key]
    pointer_path = repo_root / "data" / "releases" / "current.json"
    if not pointer_path.is_file():
        _PROCESS_PIN[key] = None
        return None
    pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    _PROCESS_PIN[key] = pointer
    return pointer


def release_identity(repo_root: Path) -> dict[str, Any]:
    pointer = pinned_pointer(repo_root)
    if pointer is None:
        return {
            "releaseId": None,
            "role": "unpinned",
            "validated": False,
            "productDataValidated": False,
            "validationScope": None,
            "lineageClass": None,
            "dataChecksPassed": False,
            "rawLineageRecovered": False,
            "markets": {},
            "summary": "No data release is pinned. Readers are using the legacy export directory.",
        }
    role = str(pointer.get("role") or "unknown")
    release_id = pointer.get("releaseId")
    lineage = pointer.get("lineageClass")
    product_data_validated = pointer.get("productDataValidated") is True
    summary = _release_summary(
        release_id=None if release_id is None else str(release_id),
        role=role,
        lineage_class=None if lineage is None else str(lineage),
        product_data_validated=product_data_validated,
    )
    markets = pointer.get("markets") if isinstance(pointer.get("markets"), dict) else {}
    return {
        "releaseId": release_id,
        "role": role,
        "validated": pointer.get("validated") is True,
        "productDataValidated": product_data_validated,
        "validationScope": pointer.get("validationScope") or role,
        "lineageClass": lineage,
        "dataChecksPassed": pointer.get("dataChecksPassed") is True,
        "rawLineageRecovered": pointer.get("rawLineageRecovered") is True,
        "markets": markets,
        "summary": summary,
    }


def _release_summary(
    *,
    release_id: str | None,
    role: str,
    lineage_class: str | None,
    product_data_validated: bool,
) -> str:
    label = release_id or "unknown"
    if role == "retained_legacy" or lineage_class == LINEAGE_LEGACY:
        return (
            f"Data release {label} is a retained legacy snapshot and is not a validated product dataset."
        )
    if role == "fixture":
        return (
            f"Data release {label} is an offline fixture. Its checks do not validate production data."
        )
    if role == "scoped_hrm_data":
        return (
            f"Data release {label} passed HRM data checks only. "
            "Vancouver is outside that scope, and fitted models were not validated."
        )
    if product_data_validated:
        return f"Data release {label} claims product data validation."
    return f"Data release {label} ({role}) is not a validated product dataset."


def resolve_published_export(repo_root: Path, filename: str) -> Path:
    """Resolve one export from the release pinned for this process.

    If no pointer existed at pin time, the legacy ``data/exports`` path is used.
    When a pointer exists, a missing file raises. Readers do not borrow the file
    from another release or from ``data/exports``.
    """
    legacy = repo_root / "data" / "exports" / filename
    pointer = pinned_pointer(repo_root)
    if pointer is None:
        return legacy
    relative = pointer.get("relativePath")
    if not relative:
        raise ReleaseError("current.json is missing relativePath")
    resolved = repo_root / "data" / "releases" / relative / "exports" / filename
    if not resolved.is_file():
        raise ReleaseError(
            f"Selected release {pointer.get('releaseId')} is missing {filename}. "
            "Readers do not fall back to another release."
        )
    return resolved


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
        profile = get_profile("retained_legacy")
        _write_pointer(
            releases_root,
            release_id=release_id,
            role=profile.role,
            lineage_class=LINEAGE_LEGACY,
            raw_lineage_recovered=False,
            profile_id=profile.profile_id,
            validation_scope=profile.validation_scope,
            data_checks_passed=False,
            markets=dict(profile.markets),
        )
    finally:
        _release_lock(lock)
    return destination
