"""Bounded HTTP fetch that cannot replace a finished file with a partial download."""

from __future__ import annotations

import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable


class FetchError(RuntimeError):
    pass


def fetch_bytes(url: str, *, attempts: int = 3, timeout: int = 300, opener: Callable | None = None) -> bytes:
    """Retry transient network failures. `attempts` includes the first try."""
    if attempts < 1:
        raise ValueError("attempts must be at least 1")
    open_url = opener or urllib.request.urlopen
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "canada-value-hub/ingest"})
            with open_url(request, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            last_error = error
            if attempt + 1 == attempts:
                break
            time.sleep(min(2**attempt, 4))
    raise FetchError(f"GET {url} failed after {attempts} attempts: {last_error}") from last_error


def write_bytes_atomically(destination: Path, payload: bytes) -> None:
    """Replace `destination` only after the full payload is on disk."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".partial")
    try:
        partial.write_bytes(payload)
        os.replace(partial, destination)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
