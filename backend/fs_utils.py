"""Filesystem helpers shared across the backend.

Centralises path-safety checks, safe folder naming and the retry logic used
when moving/removing files that a browser audio stream may still hold.
"""

from __future__ import annotations

import os
import re
import shutil
import time

from flask import Response, request

_MOVE_RETRIES = 20
_RETRY_DELAY = 0.25


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


def serve_file_range(path: str, mimetype: str) -> Response:
    """Serve a file honouring HTTP Range requests (seekable <audio>).

    Reads only the requested bytes and closes the file before responding,
    so Windows stays free to move/rename/delete it while the browser holds
    the connection — unlike ``send_file``, which keeps the handle open.
    """
    size = os.path.getsize(path)
    start, end, status = 0, size - 1, 200
    range_header = request.headers.get("Range", "")
    if range_header.startswith("bytes="):
        spec = range_header[len("bytes="):].split(",", 1)[0].strip()
        try:
            if spec.startswith("-"):
                start = max(size - int(spec[1:]), 0)
            else:
                start_s, _, end_s = spec.partition("-")
                start = int(start_s)
                if end_s:
                    end = min(int(end_s), size - 1)
            if start > end or start >= size:
                return Response(status=416, headers={"Content-Range": f"bytes */{size}"})
            status = 206
        except ValueError:
            start, end = 0, size - 1  # header malformado: servir entero
    length = max(end - start + 1, 0)
    with open(path, "rb") as f:
        f.seek(start)
        data = f.read(length)
    headers = {"Accept-Ranges": "bytes"}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return Response(data, status=status, mimetype=mimetype, headers=headers)
