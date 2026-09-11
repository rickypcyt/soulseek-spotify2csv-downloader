"""Central runtime state container.

Replaces the ~15 module-level mutable globals that previously lived in
``spotify_web`` with a single object composed of the individual services.
"""

from __future__ import annotations

import os

from backend.backend_config import BackendSettings
from backend.library_service import LibraryService
from backend.local_config import LocalConfigStore
from backend.log_service import LogService
from backend.slskd_client import SlskdClient
from backend.spotify_auth import SpotifyAuthManager


class RuntimeState:
    """Holds shared services and the mutable downloads/previews directories."""

    def __init__(self, settings: BackendSettings | None = None) -> None:
        self.settings = settings or BackendSettings.from_environment()
        self.config_store = LocalConfigStore(self.settings.config_file)
        self.logs = LogService()
        config = self.config_store.get()
        self.current_downloads_dir: str = config.get("downloads_dir") or str(self.settings.downloads_dir)
        self.previews_dir: str = os.path.join(self.current_downloads_dir, "temp")
        # Services are constructed after the base dirs so they can read them.
        self.slskd = SlskdClient(self)
        self.spotify_auth = SpotifyAuthManager(self)
        self.library = LibraryService(self)

    def set_downloads_dir(self, downloads_dir: str) -> None:
        self.current_downloads_dir = downloads_dir
        self.previews_dir = os.path.join(downloads_dir, "temp")
