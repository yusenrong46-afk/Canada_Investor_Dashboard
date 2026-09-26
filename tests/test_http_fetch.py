"""Partial downloads must not replace a completed snapshot."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from scripts.http_fetch import fetch_bytes, write_bytes_atomically


def test_transient_failures_retry_then_return_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def opener(request, timeout):  # noqa: ARG001
        calls["n"] += 1
        if calls["n"] < 3:
            raise TimeoutError("transient")

        class Response:
            def read(self) -> bytes:
                return b"full-snapshot"

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        return Response()

    monkeypatch.setattr("scripts.http_fetch.time.sleep", lambda _seconds: None)
    assert fetch_bytes("https://example.invalid/data", attempts=3, opener=opener) == b"full-snapshot"
    assert calls["n"] == 3


def test_failed_replace_keeps_the_completed_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    destination = tmp_path / "snapshot.csv"
    destination.write_bytes(b"complete")

    def fail_replace(source, target):  # noqa: ARG001
        raise OSError("replace failed")

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(OSError, match="replace failed"):
        write_bytes_atomically(destination, b"partial-download")

    assert destination.read_bytes() == b"complete"
    assert not destination.with_name(destination.name + ".partial").exists()
