"""Per-user local SQLite storage for non-secret application data."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVICE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = SERVICE_DIR / "soulseek.db"


def _connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def initialize_database(legacy_root: Path | None = None, db_path: Path = DB_PATH) -> None:
    with _connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS library_tracks (
                track_key TEXT PRIMARY KEY,
                track_name TEXT NOT NULL,
                artists TEXT NOT NULL,
                path TEXT NOT NULL,
                cover_url TEXT NOT NULL DEFAULT '',
                bpm REAL,
                downloaded_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS downloads (
                download_id TEXT PRIMARY KEY,
                playlist_key TEXT NOT NULL DEFAULT '',
                track_key TEXT NOT NULL,
                username TEXT NOT NULL,
                filename TEXT NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                path TEXT,
                state TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS playlist_track_status (
                playlist_key TEXT NOT NULL,
                track_key TEXT NOT NULL,
                downloaded INTEGER NOT NULL DEFAULT 0 CHECK(downloaded IN (0, 1)),
                ignored INTEGER NOT NULL DEFAULT 0 CHECK(ignored IN (0, 1)),
                updated_at TEXT NOT NULL,
                PRIMARY KEY (playlist_key, track_key)
            );
            CREATE TABLE IF NOT EXISTS app_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS last_playlist (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS url_history (
                url TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS search_cache (
                playlist_url TEXT NOT NULL,
                search_data TEXT NOT NULL,
                saved_at TEXT NOT NULL,
                PRIMARY KEY (playlist_url)
            );
            CREATE TABLE IF NOT EXISTS output_folder_prefs (
                playlist_url TEXT PRIMARY KEY,
                folder_name TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS search_preferences (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                pick_mode TEXT NOT NULL,
                format_pref TEXT NOT NULL,
                format_filters TEXT NOT NULL DEFAULT '["mp3", "wav", "aiff", "flac"]',
                updated_at TEXT NOT NULL
            );
            """
        )
        # Migración: añadir columna 'ignored' si no existe (DBs existentes)
        try:
            connection.execute("ALTER TABLE playlist_track_status ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0 CHECK(ignored IN (0, 1))")
        except sqlite3.OperationalError:
            pass  # La columna ya existe
        # Migración: añadir columna 'cover_url' si no existe (DBs existentes)
        try:
            connection.execute("ALTER TABLE library_tracks ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError:
            pass  # La columna ya existe
        try:
            connection.execute("ALTER TABLE library_tracks ADD COLUMN bpm REAL")
        except sqlite3.OperationalError:
            pass  # La columna ya existe
        try:
            connection.execute("ALTER TABLE search_preferences ADD COLUMN format_filters TEXT NOT NULL DEFAULT '[\"mp3\", \"wav\", \"aiff\", \"flac\"]'")
        except sqlite3.OperationalError:
            pass  # La columna ya existe
        migrated = connection.execute(
            "SELECT value FROM metadata WHERE key = 'legacy_json_migrated'"
        ).fetchone()
        if migrated or legacy_root is None:
            return

        config_path = legacy_root / "web_config.json"
        if config_path.exists():
            try:
                public = json.loads(config_path.read_text(encoding="utf-8"))
                for key, value in public.items():
                    if key == "soulseek_username" or key.endswith("_configured"):
                        continue
                    connection.execute(
                        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES (?, ?, ?)",
                        (key, str(value), _now()),
                    )
            except (OSError, json.JSONDecodeError):
                pass

        index_path = legacy_root / "web_library_index.json"
        if index_path.exists():
            try:
                index = json.loads(index_path.read_text(encoding="utf-8"))
                for track_key, item in index.items():
                    connection.execute(
                        "INSERT OR IGNORE INTO library_tracks(track_key, track_name, artists, path, downloaded_at) VALUES (?, ?, ?, ?, ?)",
                        (
                            str(track_key),
                            str(item.get("track_name", "")),
                            str(item.get("artists", "")),
                            str(item.get("path", "")),
                            _now(),
                        ),
                    )
            except (OSError, json.JSONDecodeError):
                pass

        logs_path = legacy_root / "web_logs.json"
        if logs_path.exists():
            try:
                logs = json.loads(logs_path.read_text(encoding="utf-8"))
                for message in logs[-500:]:
                    connection.execute(
                        "INSERT INTO app_logs(message, created_at) VALUES (?, ?)",
                        (str(message), _now()),
                    )
            except (OSError, json.JSONDecodeError):
                pass

        connection.execute(
            "INSERT INTO metadata(key, value) VALUES ('legacy_json_migrated', ?)",
            (_now(),),
        )


def get_settings(db_path: Path = DB_PATH) -> dict[str, str]:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        rows = connection.execute("SELECT key, value FROM settings").fetchall()
    return {row["key"]: row["value"] for row in rows}


def update_settings(values: dict[str, Any], db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        for key, value in values.items():
            connection.execute(
                "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (key, str(value), _now()),
            )


def get_library_index(db_path: Path = DB_PATH) -> dict[str, dict[str, str]]:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        rows = connection.execute("SELECT * FROM library_tracks").fetchall()
    return {
        row["track_key"]: {
            "track_key": row["track_key"],
            "track_name": row["track_name"],
            "artists": row["artists"],
            "path": row["path"],
            "cover_url": row["cover_url"],
            "bpm": row["bpm"],
        }
        for row in rows
    }


def get_playlist_track_statuses(playlist_key: str, db_path: Path = DB_PATH) -> dict[str, dict[str, bool]]:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        rows = connection.execute(
            "SELECT track_key, downloaded, ignored FROM playlist_track_status WHERE playlist_key = ?",
            (str(playlist_key),),
        ).fetchall()
    return {
        row["track_key"]: {"downloaded": bool(row["downloaded"]), "ignored": bool(row["ignored"])}
        for row in rows
    }


def update_library_metadata_by_path(path: str, track_name: str, artists: str, db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "UPDATE library_tracks SET track_name = ?, artists = ?, downloaded_at = ? WHERE path = ?",
            (str(track_name), str(artists), _now(), str(path)),
        )


def update_library_bpm(track_key: str, bpm: float, db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "UPDATE library_tracks SET bpm = ?, downloaded_at = ? WHERE track_key = ?",
            (float(bpm), _now(), str(track_key)),
        )


def set_playlist_track_status(playlist_key: str, track_key: str, downloaded: bool, ignored: bool | None = None, db_path: Path = DB_PATH) -> None:
    if not playlist_key or not track_key:
        raise ValueError("Falta playlist_key o track_key")
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        existing = connection.execute(
            "SELECT downloaded, ignored FROM playlist_track_status WHERE playlist_key = ? AND track_key = ?",
            (str(playlist_key), str(track_key)),
        ).fetchone()
        if existing is None:
            ign_val = 1 if ignored else 0
            connection.execute(
                "INSERT INTO playlist_track_status(playlist_key, track_key, downloaded, ignored, updated_at) VALUES (?, ?, ?, ?, ?)",
                (str(playlist_key), str(track_key), 1 if downloaded else 0, ign_val, _now()),
            )
        else:
            ign_val = existing["ignored"] if ignored is None else (1 if ignored else 0)
            connection.execute(
                "UPDATE playlist_track_status SET downloaded = ?, ignored = ?, updated_at = ? WHERE playlist_key = ? AND track_key = ?",
                (1 if downloaded else 0, ign_val, _now(), str(playlist_key), str(track_key)),
            )


def register_library_track(track_key: str, track_name: str, artists: str, path: str, cover_url: str = "", db_path: Path = DB_PATH) -> None:
    if not track_key:
        return
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "INSERT INTO library_tracks(track_key, track_name, artists, path, cover_url, downloaded_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(track_key) DO UPDATE SET track_name=excluded.track_name, artists=excluded.artists, path=excluded.path, cover_url=excluded.cover_url, downloaded_at=excluded.downloaded_at",
            (str(track_key), str(track_name or ""), str(artists or ""), str(path), str(cover_url or ""), _now()),
        )


def register_download(
    download_id: str,
    playlist_key: str,
    track_key: str,
    username: str,
    filename: str,
    size: int,
    db_path: Path = DB_PATH,
) -> None:
    if not download_id or not track_key:
        return
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "INSERT INTO downloads(download_id, playlist_key, track_key, username, filename, size, state, started_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (download_id, playlist_key or "", track_key, username, filename, int(size or 0), "queued", _now()),
        )


def complete_download(download_id: str, path: str, state: str = "completed", db_path: Path = DB_PATH) -> None:
    if not download_id:
        return
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "UPDATE downloads SET path = ?, state = ?, completed_at = ? WHERE download_id = ?",
            (path, state, _now(), download_id),
        )


def remove_library_paths(path: str, db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    prefix = path.rstrip("/") + "/"
    with _connect(db_path) as connection:
        connection.execute(
            "DELETE FROM library_tracks WHERE path = ? OR path LIKE ?",
            (path, f"{prefix}%"),
        )


def move_library_path(old_path: str, new_path: str, db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "UPDATE library_tracks SET path = ?, downloaded_at = ? WHERE path = ?",
            (new_path, _now(), old_path),
        )


def load_logs(limit: int = 200, db_path: Path = DB_PATH) -> list[str]:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        rows = connection.execute(
            "SELECT message FROM app_logs ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [row["message"] for row in reversed(rows)]


def save_logs(messages: list[str], db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute("DELETE FROM app_logs")
        connection.executemany(
            "INSERT INTO app_logs(message, created_at) VALUES (?, ?)",
            [(str(message), _now()) for message in messages[-500:]],
        )


# ---- last playlist ---------------------------------------------------------
def load_last_playlist(db_path: Path = DB_PATH) -> dict[str, Any]:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        row = connection.execute("SELECT data FROM last_playlist WHERE id = 1").fetchone()
    if not row:
        return {}
    try:
        return json.loads(row["data"])
    except (json.JSONDecodeError, TypeError):
        return {}


def save_last_playlist(data: dict[str, Any], db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "INSERT INTO last_playlist(id, data, updated_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            (json.dumps(data), _now()),
        )


# ---- url history ------------------------------------------------------------
def load_url_history(db_path: Path = DB_PATH) -> list[dict[str, str]]:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        rows = connection.execute(
            "SELECT url, name FROM url_history ORDER BY updated_at DESC LIMIT 20"
        ).fetchall()
    return [{"url": row["url"], "name": row["name"]} for row in rows]


def save_url_history(entries: list[dict[str, str]], db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    now = _now()
    with _connect(db_path) as connection:
        for entry in entries[:20]:
            connection.execute(
                "INSERT INTO url_history(url, name, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(url) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at",
                (entry["url"], entry["name"], now),
            )


def clear_url_history(db_path: Path = DB_PATH) -> None:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute("DELETE FROM url_history")


# ---- search cache ----------------------------------------------------------
def load_search_cache(playlist_url: str, db_path: Path = DB_PATH) -> list[dict[str, Any]]:
    if not playlist_url:
        return []
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT search_data, saved_at FROM search_cache WHERE playlist_url = ?",
            (playlist_url,),
        ).fetchone()
    if not row:
        return []
    try:
        data = json.loads(row["search_data"])
        saved_at = row["saved_at"]
        if _is_cache_expired(saved_at):
            return []
        return data.get("searches", [])
    except (json.JSONDecodeError, TypeError):
        return []


def save_search_cache(playlist_url: str, searches: list[dict[str, Any]], db_path: Path = DB_PATH) -> None:
    if not playlist_url:
        return
    initialize_database(db_path=db_path)
    cacheable = json.dumps({"savedAt": _now(), "searches": searches})
    with _connect(db_path) as connection:
        connection.execute(
            "INSERT INTO search_cache(playlist_url, search_data, saved_at) VALUES (?, ?, ?) "
            "ON CONFLICT(playlist_url) DO UPDATE SET search_data=excluded.search_data, saved_at=excluded.saved_at",
            (playlist_url, cacheable, _now()),
        )


def _is_cache_expired(saved_at: str, ttl_days: int = 7) -> bool:
    try:
        saved = datetime.fromisoformat(saved_at)
        if saved.tzinfo is None:
            saved = saved.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - saved
        return age.days >= ttl_days
    except (ValueError, TypeError):
        return True


# ---- output folder preferences ---------------------------------------------
def load_output_folder_prefs(db_path: Path = DB_PATH) -> dict[str, str]:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        rows = connection.execute("SELECT playlist_url, folder_name FROM output_folder_prefs").fetchall()
    return {row["playlist_url"]: row["folder_name"] for row in rows}


def get_output_folder_pref(playlist_url: str, db_path: Path = DB_PATH) -> str | None:
    if not playlist_url:
        return None
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT folder_name FROM output_folder_prefs WHERE playlist_url = ?",
            (playlist_url,),
        ).fetchone()
    return row["folder_name"] if row else None


def set_output_folder_pref(playlist_url: str, folder_name: str, db_path: Path = DB_PATH) -> None:
    if not playlist_url:
        return
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "INSERT INTO output_folder_prefs(playlist_url, folder_name, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(playlist_url) DO UPDATE SET folder_name=excluded.folder_name, updated_at=excluded.updated_at",
            (playlist_url, folder_name or "", _now()),
        )


# ---- search preferences ----------------------------------------------------
DEFAULT_FORMAT_FILTERS = ["mp3", "wav", "aiff", "flac"]


def load_search_prefs(db_path: Path = DB_PATH) -> dict[str, Any]:
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        row = connection.execute("SELECT pick_mode, format_pref, format_filters FROM search_preferences WHERE id = 1").fetchone()
    if not row:
        return {"pickMode": "quality", "formatPref": "any", "formatFilters": DEFAULT_FORMAT_FILTERS}
    try:
        format_filters = json.loads(row["format_filters"] or "[]")
    except (TypeError, json.JSONDecodeError):
        format_filters = DEFAULT_FORMAT_FILTERS
    return {
        "pickMode": row["pick_mode"],
        "formatPref": row["format_pref"],
        "formatFilters": format_filters,
    }


def save_search_prefs(
    pick_mode: str,
    format_pref: str,
    format_filters: list[str] | None = None,
    db_path: Path = DB_PATH,
) -> None:
    initialize_database(db_path=db_path)
    filters = format_filters if format_filters is not None else DEFAULT_FORMAT_FILTERS
    with _connect(db_path) as connection:
        connection.execute(
            "INSERT INTO search_preferences(id, pick_mode, format_pref, format_filters, updated_at) VALUES (1, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET pick_mode=excluded.pick_mode, format_pref=excluded.format_pref, format_filters=excluded.format_filters, updated_at=excluded.updated_at",
            (pick_mode, format_pref, json.dumps(filters), _now()),
        )
