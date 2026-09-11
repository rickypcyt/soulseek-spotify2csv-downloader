"""Filesystem helpers shared across the backend.

Centralises path-safety checks, safe folder naming and the retry logic used
when moving/removing files that a browser audio stream may still hold.
"""

from __future__ import annotations

import os
import re
import shutil
import time

_MOVE_RETRIES = 8
_RETRY_DELAY = 0.2


def safe_dirname(name: str) -> str:
    """Sanitise a folder name, stripping Windows-reserved characters."""
    if not name:
        return "sin_nombre"
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    return name.strip(" .") or "sin_nombre"


def safe_join(base: str, relative: str) -> str:
    """Resolve ``relative`` under ``base`` and reject paths escaping ``base``."""
    base_path = os.path.abspath(base)
    candidate = os.path.abspath(os.path.join(base_path, relative.lstrip("/\\")))
    try:
        if os.path.commonpath([base_path, candidate]) != os.path.commonpath([base_path]):
            raise ValueError("Path fuera del directorio permitido")
    except ValueError as exc:
        raise ValueError("Path fuera del directorio permitido") from exc
    return candidate


def move_file_with_retry(source: str, destination: str) -> None:
    """Move a file, retrying briefly while a browser stream releases its handle."""
    for attempt in range(_MOVE_RETRIES):
        try:
            shutil.move(source, destination)
            return
        except PermissionError:
            if attempt == _MOVE_RETRIES - 1:
                raise
            time.sleep(_RETRY_DELAY)


def remove_file_with_retry(path: str) -> None:
    """Remove a file, retrying briefly while a browser stream releases it."""
    for attempt in range(_MOVE_RETRIES):
        try:
            os.remove(path)
            return
        except PermissionError:
            if attempt == _MOVE_RETRIES - 1:
                raise
            time.sleep(_RETRY_DELAY)
