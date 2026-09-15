"""First-run bootstrap: download and extract slskd.exe if missing.

Replicates the logic of ``setup.ps1`` in pure Python so the packaged
.exe can self-provision slskd without requiring PowerShell or Git.
"""

from __future__ import annotations

import io
import os
import zipfile
from pathlib import Path

import requests

from backend.paths import slskd_dir, slskd_exe_path

SLSKD_VERSION = "0.26.0"
SLSKD_URL = (
    f"https://github.com/slskd/slskd/releases/download/{SLSKD_VERSION}"
    f"/slskd-{SLSKD_VERSION}-win-x64.zip"
)


def find_existing_slskd(root: Path) -> Path | None:
    """Search ``root`` recursively for ``slskd.exe``."""
    if not root.exists():
        return None
    for path in root.rglob("slskd.exe"):
        if path.is_file():
            return path
    return None


def search_slskd_everywhere() -> Path | None:
    """Search common locations for an existing slskd.exe before downloading.

    Order:
      1. Next to the .exe (or repo root in dev).
      2. ``slskd-*/`` subfolder next to the .exe (legacy setup.ps1 layout).
      3. ``vendor/slskd/`` (dev mode default).
      4. Configured path in the config store, if valid.
    """
    from backend.paths import app_root, exe_dir

    candidates = [
        exe_dir(),
        exe_dir() / "slskd-0.26.0-win-x64",
        app_root() / "vendor" / "slskd",
        app_root() / "slskd-0.26.0-win-x64",
    ]
    for base in candidates:
        # Direct file check first (fast path).
        direct = base / "slskd.exe"
        if direct.is_file():
            print(f"[bootstrap] slskd encontrado en {direct}")
            return direct
        # Recursive search as fallback.
        found = find_existing_slskd(base)
        if found:
            print(f"[bootstrap] slskd encontrado en {found}")
            return found
    return None


def download_slskd(progress_prefix: str = "") -> Path | None:
    """Download and extract slskd. Returns the path to slskd.exe or None on failure."""
    target_dir = slskd_dir()
    target_dir.mkdir(parents=True, exist_ok=True)

    existing = find_existing_slskd(target_dir)
    if existing:
        print(f"{progress_prefix}slskd ya está disponible en {existing}")
        return existing

    print(f"{progress_prefix}Descargando slskd {SLSKD_VERSION}...")
    try:
        response = requests.get(SLSKD_URL, stream=True, timeout=120)
        response.raise_for_status()
        total = int(response.headers.get("content-length", 0))
        downloaded = 0
        buf = io.BytesIO()
        for chunk in response.iter_content(chunk_size=65536):
            if not chunk:
                continue
            buf.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded * 100 // total
                print(f"\r{progress_prefix}Descargando slskd... {pct}%", end="", flush=True)
            else:
                print(f"\r{progress_prefix}Descargando slskd... {downloaded // 1024} KB", end="", flush=True)
        print()
        buf.seek(0)

        print(f"{progress_prefix}Extrayendo slskd...")
        with zipfile.ZipFile(buf) as archive:
            archive.extractall(target_dir)
    except Exception as exc:
        print(f"{progress_prefix}Error descargando slskd: {exc}")
        return None

    exe = find_existing_slskd(target_dir)
    if exe:
        print(f"{progress_prefix}slskd instalado en {exe}")
    else:
        print(f"{progress_prefix}No se encontró slskd.exe tras la extracción.")
    return exe


def ensure_slskd(config_store) -> Path | None:
    """Ensure slskd.exe is available and configured.

    Order of resolution:
      1. Path already configured in the config store, if it still exists.
      2. Search common locations (next to .exe, subfolders, vendor).
      3. Download slskd from GitHub releases.

    Returns the path to slskd.exe, or None if it could not be obtained.
    """
    # 1. Already configured and still present?
    config = config_store.get()
    configured = config.get("slskd_path", "")
    if configured and os.path.isfile(configured):
        print(f"[bootstrap] slskd configurado: {configured}")
        return Path(configured)

    # 2. Search common locations before downloading.
    found = search_slskd_everywhere()
    if found:
        wwwroot = found.parent / "wwwroot"
        wwwroot.mkdir(parents=True, exist_ok=True)
        config_store.update({"slskd_path": str(found), "provider": "slskd"})
        return found

    # 3. Download as last resort.
    exe = download_slskd(progress_prefix="[bootstrap] ")
    if not exe:
        return None

    # Create wwwroot next to slskd.exe (slskd expects it).
    wwwroot = exe.parent / "wwwroot"
    wwwroot.mkdir(parents=True, exist_ok=True)

    config_store.update({"slskd_path": str(exe), "provider": "slskd"})
    return exe
