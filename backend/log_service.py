"""In-memory log buffer persisted to the per-user SQLite database."""

from __future__ import annotations

import threading
from collections import deque
from datetime import datetime

from backend.database import load_logs, save_logs

_MAX_LOGS = 200


class LogService:
    """Thread-safe ring buffer of log lines mirrored to the database."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._messages: deque[str] = deque(load_logs(), maxlen=_MAX_LOGS)

    def add(self, message: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {message}"
        with self._lock:
            self._messages.append(line)
            save_logs(list(self._messages))

    def all(self) -> list[str]:
        with self._lock:
            return list(self._messages)
