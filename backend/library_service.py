"""Library track bookkeeping and playlist-name helpers.

Wraps the per-user SQLite database access for library tracks plus the small
helpers that read the playlist name produced by the CSV converter.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from backend.database import (
    get_library_index,
)
from backend.database import (
    move_library_path as _move_database_path,
)
from backend.database import (
    register_library_track as _register_database_track,
)
from backend.database import (
    remove_library_paths as _remove_database_paths,
)

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


class LibraryService:
    def __init__(self, state: RuntimeState) -> None:
        self.state = state

    def playlist_name(self) -> str:
        path = self.state.settings.playlist_name_file
        if not os.path.exists(path):
            return ""
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            return ""

    def index(self) -> dict[str, dict[str, str]]:
        return get_library_index()

    def register_track(self, track_key, track_name, artists, path, cover_url="") -> None:
        _register_database_track(track_key, track_name, artists, path, cover_url)

    def move_path(self, old_path: str, new_path: str) -> None:
        _move_database_path(old_path, new_path)

    def remove_paths(self, path: str) -> None:
        _remove_database_paths(path)
