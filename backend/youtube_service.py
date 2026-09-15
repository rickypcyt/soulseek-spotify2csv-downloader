import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path


class YouTubeServiceError(RuntimeError):
    """Raised when a YouTube download fails."""


def _is_youtube_url(url: str) -> bool:
    return bool(re.match(r"^(https?://)?(www\.)?(youtube\.com/watch\?|youtu\.be/)", url, re.IGNORECASE))


def _find_ytdlp() -> str:
    candidates = []
    if not getattr(sys, "frozen", False):
        candidates.extend([
            str(Path(sys.executable).parent / "Scripts" / "yt-dlp.exe"),
            str(Path(sys.executable).parent / "Scripts" / "yt-dlp"),
        ])
    candidates.extend(["yt-dlp", "yt-dlp.exe"])
    for candidate in candidates:
        resolved = shutil.which(candidate) or candidate
        try:
            result = subprocess.run([resolved, "--version"], capture_output=True, check=False, timeout=5)
            if result.returncode == 0:
                return resolved
        except FileNotFoundError:
            continue
    raise YouTubeServiceError("No se encontró yt-dlp. Instalalo con: python -m pip install -U yt-dlp")


def _youtube_options(ytdlp: str) -> list[str]:
    help_result = subprocess.run([ytdlp, "--help"], capture_output=True, text=True, timeout=15, check=False)
    help_text = f"{help_result.stdout}\n{help_result.stderr}"
    options = ["--no-update"]
    runtimes = (("deno", "deno"), ("node", "node"), ("bun", "bun"), ("quickjs", "qjs"))
    for runtime, executable in runtimes:
        path = shutil.which(executable)
        if path and "--js-runtimes" in help_text:
            options.extend(["--js-runtimes", f"{runtime}:{path}"])
            break
    if "--remote-components" in help_text:
        options.extend(["--remote-components", "ejs:github"])
    return options


def _download_error(result: subprocess.CompletedProcess[str]) -> str:
    details = (result.stderr or result.stdout).strip()
    if "HTTP Error 403" in details:
        details += "\nActualizá yt-dlp con: python -m pip install -U yt-dlp"
    return details or "Error desconocido al descargar YouTube"


def download_youtube_audio(url: str, output_dir: Path, audio_format: str = "flac") -> Path:
    if not _is_youtube_url(url):
        raise YouTubeServiceError("La URL no parece ser de YouTube.")

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    start_time = time.time()
    ytdlp = _find_ytdlp()
    template = str(output_dir / f"%(title)s.{audio_format}")
    command = [
        ytdlp,
        *_youtube_options(ytdlp),
        "--no-playlist",
        "--no-progress",
        "--print",
        "after_move:filepath",
        "-x",
        "--audio-format",
        audio_format,
        "--audio-quality",
        "0",
        "-o",
        template,
        url,
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=600, check=False)
    except subprocess.TimeoutExpired as exc:
        raise YouTubeServiceError("La descarga de YouTube tardó demasiado.") from exc
    if result.returncode != 0:
        raise YouTubeServiceError(_download_error(result))

    printed_paths = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]
    for target_path in reversed(printed_paths):
        if target_path.is_file():
            return target_path

    files = [p for p in output_dir.iterdir() if p.is_file() and p.stat().st_mtime > start_time]
    if not files:
        raise YouTubeServiceError("No se encontró el archivo descargado")
    return max(files, key=lambda p: p.stat().st_mtime)
