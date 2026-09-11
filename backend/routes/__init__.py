"""Flask blueprints organised by domain.

Each module exposes ``create_blueprint(state)`` returning a configured
``Blueprint``. ``register_blueprints`` wires them all onto the app.
"""

from __future__ import annotations

from flask import Flask

from backend.routes import (
    config_routes,
    diagnostics,
    download,
    files,
    library,
    logs,
    pages,
    preview,
    search,
    spotify_routes,
)
from backend.runtime import RuntimeState


def register_blueprints(app: Flask, state: RuntimeState) -> None:
    app.register_blueprint(pages.create_blueprint(state))
    app.register_blueprint(logs.create_blueprint(state))
    app.register_blueprint(preview.create_blueprint(state))
    app.register_blueprint(search.create_blueprint(state))
    app.register_blueprint(download.create_blueprint(state))
    app.register_blueprint(library.create_blueprint(state))
    app.register_blueprint(config_routes.create_blueprint(state))
    app.register_blueprint(spotify_routes.create_blueprint(state))
    app.register_blueprint(files.create_blueprint(state))
    app.register_blueprint(diagnostics.create_blueprint(state))
