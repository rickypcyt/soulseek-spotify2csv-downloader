"""Flask application factory.

Wires the static frontend folder and the domain blueprints onto a single
``Flask`` app backed by a :class:`RuntimeState` instance.
"""

from __future__ import annotations

from flask import Flask

from backend.routes import register_blueprints
from backend.runtime import RuntimeState


def create_app(state: RuntimeState | None = None) -> tuple[Flask, RuntimeState]:
    """Build the Flask app and its runtime state.

    Returns ``(app, state)`` so callers (tests, entry points) can reach the
    shared services.
    """
    state = state or RuntimeState()
    app = Flask(__name__, static_folder=str(state.settings.dist_dir), static_url_path="")
    register_blueprints(app, state)
    return app, state
