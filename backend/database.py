"""Per-user local SQLite storage for non-secret application data."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVICE_DIR = Path.home() / ".spotify-soulseek"
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
                downloaded_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
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
            "track_name": row["track_name"],
            "artists": row["artists"],
            "path": row["path"],
        }
        for row in rows
    }


def register_library_track(track_key: str, track_name: str, artists: str, path: str, db_path: Path = DB_PATH) -> None:
    if not track_key:
        return
    initialize_database(db_path=db_path)
    with _connect(db_path) as connection:
        connection.execute(
            "INSERT INTO library_tracks(track_key, track_name, artists, path, downloaded_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(track_key) DO UPDATE SET track_name=excluded.track_name, artists=excluded.artists, path=excluded.path, downloaded_at=excluded.downloaded_at",
            (str(track_key), str(track_name or ""), str(artists or ""), str(path), _now()),
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
