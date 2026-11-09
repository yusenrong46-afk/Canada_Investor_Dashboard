from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def display_path(value: str | Path) -> str:
    """Repo-relative path for provenance, logs, and client messages.

    Paths outside the repository collapse to their file name so committed outputs and API
    responses never leak a developer's or server's absolute machine path.
    """
    path = Path(value).expanduser()
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except (OSError, ValueError):
        return path.name
