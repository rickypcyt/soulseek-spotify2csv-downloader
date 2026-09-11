"""Entry point for the local Spotify → Soulseek web service.

Run with ``python -m backend.spotify_web``. All routing and service logic
lives in :mod:`backend.app` and the ``backend.routes`` package; this module
only constructs the app and starts the HTTP server.
"""

from __future__ import annotations

import os

from backend.app import create_app

# Re-exported for backwards compatibility with existing imports/tests.
from backend.fs_utils import safe_dirname as _safe_dirname  # noqa: F401

app, state = create_app()


def main() -> None:
    dev_mode = os.getenv("SOULSEEK_DEV") == "1"
    state.slskd.start_from_config()
    app.run(debug=dev_mode, use_reloader=dev_mode, host="127.0.0.1", port=5000)


if __name__ == "__main__":
    main()
