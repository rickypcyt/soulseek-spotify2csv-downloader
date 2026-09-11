"""Static index page routes."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from flask import Blueprint, send_file

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("pages", __name__)

    @bp.route("/")
    @bp.route("/settings")
    @bp.route("/logs")
    @bp.route("/library")
    def index():
        index_html = os.path.join(str(state.settings.dist_dir), "index.html")
        if not os.path.exists(index_html):
            return "No se encontro el build de React. Corre 'npm run build' en frontend/", 404
        return send_file(index_html)

    return bp
