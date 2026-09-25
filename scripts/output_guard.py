"""Shared path and write helpers for release builds."""

from __future__ import annotations

import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def env_path(name: str, fallback: Path) -> Path:
    value = os.environ.get(name)
    if value:
        return Path(value)
    return fallback


def export_file(filename: str, legacy: Path) -> Path:
    directory = os.environ.get("CVH_EXPORT_DIR")
    if directory:
        return Path(directory) / filename
    return legacy


def report_file(filename: str, legacy: Path) -> Path:
    directory = os.environ.get("CVH_REPORT_DIR")
    if directory:
        return Path(directory) / filename
    return legacy


def strict_from_env(default: bool = False) -> bool:
    flag = os.environ.get("CVH_STRICT")
    if flag in {"0", "1"}:
        return flag == "1"
    if os.environ.get("CI", "").lower() in {"1", "true", "yes"}:
        return True
    return default


def is_legacy_output(path: Path) -> bool:
    """Published product paths that candidate builds must not overwrite."""
    resolved = path.resolve()
    protected_dirs = [
        REPO_ROOT / "data" / "exports",
        REPO_ROOT / "data" / "warehouse",
        REPO_ROOT / "reports",
    ]
    for root in protected_dirs:
        root_resolved = root.resolve()
        if resolved == root_resolved or root_resolved in resolved.parents:
            return True
    return False


def refuse_legacy_write(path: Path) -> None:
    if os.environ.get("CVH_ALLOW_LEGACY_OUTPUT") == "1":
        return
    if is_legacy_output(path):
        raise SystemExit(
            f"Refusing to write {path}. Candidate builds must write under data/releases/candidates. "
            "Set CVH_ALLOW_LEGACY_OUTPUT=1 only for an explicit legacy-path regeneration."
        )


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_text(text, encoding="utf-8")
    os.replace(partial, path)


def public_storage_ref(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT.resolve()))
    except ValueError:
        return "local-file-not-in-repo"
