"""Path resolution for development and frozen (PyInstaller) mode.

In development, all paths are relative to the repository root.
When packaged as a single .exe with PyInstaller:
  - Read-only resources (frontend/dist) live inside ``_MEIPASS``.
  - User data (database, config, logs, slskd) live next to the .exe,
    so the user can find them easily and carry them on a USB drive.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    """True when running inside a PyInstaller bundle."""
    return getattr(sys, "frozen", False)


def app_root() -> Path:
    """Root of read-only application resources.

    In dev: the repository root (parent of ``backend/``).
    In frozen mode: ``sys._MEIPASS`` (the temp extraction folder).
    """
    if is_frozen():
        return Path(sys._MEIPASS)  # type:ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


def exe_dir() -> Path:
    """Directory containing the .exe (frozen) or the repo root (dev).

    This is where user-writable files live: database, config, logs, slskd.
    Keeping them next to the .exe makes the app portable (USB drive friendly)
    and lets the user find/backup their data easily.
    """
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    """Writable directory for persistent user data (db, config, logs).

    ``data/`` next to the .exe when frozen, ``data/`` under the repo root in dev.
    ``SOULSEEK_DATA_DIR`` overrides the location (used by ``start.ps1 -SkipBuild``
    to share the same database as the packaged exe).
    Files created by older versions at the root are migrated on first access.
    """
    override = os.environ.get("SOULSEEK_DATA_DIR")
    d = Path(override) if override else exe_dir() / "data"
    d.mkdir(parents=True, exist_ok=True)
    _migrate_legacy_data(d)
    return d


_LEGACY_DATA_FILES = (
    "soulseek.db",
    "soulseek.db-wal",
    "soulseek.db-shm",
    "web_config.json",
    "web_logs.json",
    "web_library_index.json",
    "web_output.csv",
    "web_output_playlist_name.txt",
    "web_playlist_name.txt",
    "spotify2soulseek.log",
)


def _migrate_legacy_data(target: Path) -> None:
    """Move data files created at the root by older versions into ``data/``."""
    root = exe_dir()
    if root == target:
        return
    for name in _LEGACY_DATA_FILES:
        src = root / name
        dst = target / name
        try:
            if src.is_file() and not dst.exists():
                src.replace(dst)
        except OSError:
            pass


def frontend_dist() -> Path:
    """Compiled frontend assets (Vite build output)."""
    return app_root() / "frontend" / "dist"


def slskd_dir() -> Path:
    """Directory where the slskd binary is stored.

    Next to the .exe when frozen; ``vendor/slskd`` in dev.
    """
    if is_frozen():
        return exe_dir()
    return app_root() / "vendor" / "slskd"


def slskd_exe_path() -> Path:
    """Default expected location of slskd.exe (next to the .exe / in vendor)."""
    return slskd_dir() / "slskd.exe"
