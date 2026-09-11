"""Diagnostics endpoint aggregating filesystem and slskd state."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from flask import Blueprint, jsonify

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("diagnostics", __name__)

    @bp.route("/api/diagnostics")
    def api_diagnostics():
        try:
            previews_dir = state.previews_dir
            downloads_dir = state.current_downloads_dir
            files = []
            if os.path.isdir(previews_dir):
                for root, _, names in os.walk(previews_dir):
                    for n in names:
                        full = os.path.join(root, n)
                        rel = os.path.relpath(full, previews_dir).replace("\\", "/")
                        files.append({"path": rel, "size": os.path.getsize(full), "dir": "previews"})
            downloads_files = []
            download_directories = []
            if os.path.isdir(downloads_dir):
                for root, dirs, names in os.walk(downloads_dir):
                    rel_root = os.path.relpath(root, downloads_dir).replace("\\", "/")
                    if rel_root != "." and not rel_root.split("/")[0].lower() in {"temp", ".incomplete"}:
                        download_directories.append(rel_root)
                    for n in names:
                        full = os.path.join(root, n)
                        rel = os.path.relpath(full, downloads_dir).replace("\\", "/")
                        if rel.split("/")[0].lower() in {"temp", ".incomplete"}:
                            continue
                        downloads_files.append({"path": rel, "size": os.path.getsize(full), "dir": "downloads"})
            transfers = state.slskd.active_transfers()
            current_config = state.config_store.get()
            slskd_path = current_config.get("slskd_path", "")
            return jsonify({
                "previews": files,
                "downloads": downloads_files,
                "download_directories": sorted(set(download_directories), key=str.casefold),
                "library_index": state.library.index(),
                "transfers": transfers,
                "configuration": {
                    "backend": {"ready": True},
                    "spotify": {
                        "clientIdConfigured": bool(current_config.get("spotify_client_id")),
                        "clientSecretConfigured": bool(current_config.get("spotify_client_secret_configured")),
                    },
                    "slskd": {
                        "url": state.slskd.url,
                        "reachable": state.slskd.reachable(),
                        "apiKeyConfigured": bool(current_config.get("slskd_api_key_configured")),
                        "executableConfigured": bool(slskd_path),
                        "executableExists": bool(slskd_path and os.path.isfile(slskd_path)),
                    },
                    "downloads": {
                        "path": downloads_dir,
                        "exists": bool(downloads_dir and os.path.isdir(downloads_dir)),
                    },
                },
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return bp
