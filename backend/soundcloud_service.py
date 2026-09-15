from __future__ import annotations

import contextlib
import io
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

from backend.youtube_service import YouTubeServiceError, _download_error, _find_ytdlp


class SoundCloudServiceError(RuntimeError):
    """Raised when lucidadl cannot process a SoundCloud URL."""


def _is_soundcloud_url(url: str) -> bool:
    return bool(re.match(r"^https?://(www\.)?soundcloud\.com/", url, re.IGNORECASE))


def _lucida_command() -> list[str]:
    for executable in ("lucida", "lucidadl"):
        if shutil.which(executable):
            return [executable]
    if not getattr(sys, "frozen", False):
        return [sys.executable, "-m", "lucidadl"]
    return []


def _run_bundled_lucida(args: list[str]) -> str:
    try:
        from lucidadl.cli import cli
    except ImportError as exc:
        raise SoundCloudServiceError(
            "No se encontró lucidadl. Instalalo con: pip install lucidadl y ejecutá lucida setup."
        ) from exc

    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            cli.main(args=args, standalone_mode=False)
    except SystemExit as exc:
        if exc.code not in (None, 0):
            details = stderr.getvalue().strip() or stdout.getvalue().strip()
            raise SoundCloudServiceError(details or "lucidadl no pudo descargar el contenido.") from exc
    except Exception as exc:
        details = stderr.getvalue().strip() or stdout.getvalue().strip()
        raise SoundCloudServiceError(details or str(exc)) from exc
    return stdout.getvalue().strip()


def _download_soundcloud_track(url: str, output_dir: Path) -> str:
    start_time = time.time()
    try:
        ytdlp = _find_ytdlp()
    except YouTubeServiceError as exc:
        raise SoundCloudServiceError(str(exc)) from exc
    template = str(output_dir / "%(title)s.flac")
    command = [
        ytdlp,
        "--no-update",
        "--no-playlist",
        "--no-progress",
        "--print",
        "after_move:filepath",
        "-x",
        "--audio-format",
        "flac",
        "--audio-quality",
        "0",
        "-o",
        template,
        url,
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=600, check=False)
    except subprocess.TimeoutExpired as exc:
        raise SoundCloudServiceError("La descarga de SoundCloud tardó demasiado.") from exc
    if result.returncode != 0:
        raise SoundCloudServiceError(_download_error(result))
    for line in reversed(result.stdout.splitlines()):
        path = Path(line.strip())
        if path.is_file():
            return str(path)
    files = [p for p in output_dir.iterdir() if p.is_file() and p.stat().st_mtime > start_time]
    if not files:
        raise SoundCloudServiceError("No se encontró el archivo descargado.")
    return str(max(files, key=lambda p: p.stat().st_mtime))


def download_soundcloud(url: str, output_dir: Path) -> str:
    if not _is_soundcloud_url(url):
        raise SoundCloudServiceError("La URL no parece ser de SoundCloud.")

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if "/sets/" not in url.lower():
        return _download_soundcloud_track(url, output_dir)
    command = _lucida_command() + [
        "playlist",
        url,
        "--out",
        str(output_dir),
        "--to",
        "flac",
    ]
    if not command:
        output = _run_bundled_lucida(command[1:] if command else [
            "playlist", url, "--out", str(output_dir), "--to", "flac"
        ])
        return output.splitlines()[-1] if output else str(output_dir)

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=1800,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SoundCloudServiceError("lucidadl tardó demasiado en completar la descarga.") from exc
    if result.returncode != 0:
        details = (result.stderr or result.stdout).strip()
        raise SoundCloudServiceError(details or "lucidadl no pudo descargar el contenido.")
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else str(output_dir)
