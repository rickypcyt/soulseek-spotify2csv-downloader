"""File streaming and download endpoints for the downloads/previews dirs."""

from __future__ import annotations

import mimetypes
import os
from typing import TYPE_CHECKING

from flask import Blueprint, abort, request, send_file

from backend.fs_utils import safe_join

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("files", __name__)

    def _resolve(dir_key: str, rel: str) -> str:
        base = state.current_downloads_dir if dir_key == "downloads" else state.previews_dir
        return safe_join(base, rel)

    @bp.route("/api/file/download")
    def api_file_download():
        rel = request.args.get("path", "").strip()
        dir_key = request.args.get("dir", "downloads").strip()
        if not rel or dir_key not in {"downloads", "previews"}:
            abort(400)
        try:
            full = _resolve(dir_key, rel)
        except ValueError:
            abort(403)
        if not os.path.isfile(full):
            abort(404)
        return send_file(full, as_attachment=True, download_name=os.path.basename(full))

    @bp.route("/api/file/stream")
    def api_file_stream():
        rel = request.args.get("path", "").strip()
        dir_key = request.args.get("dir", "downloads").strip()
        if not rel or dir_key not in {"downloads", "previews"}:
            abort(400)
        try:
            full = _resolve(dir_key, rel)
        except ValueError:
            abort(403)
        if not os.path.isfile(full):
            abort(404)
        mimetype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        return send_file(full, mimetype=mimetype, conditional=True, as_attachment=False)

    return bp
