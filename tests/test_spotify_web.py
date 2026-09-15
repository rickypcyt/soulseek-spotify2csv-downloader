from types import SimpleNamespace

import pytest

from backend.fs_utils import safe_dirname as _safe_dirname
from backend.fs_utils import safe_join as _safe_join


def test_safe_dirname_removes_windows_reserved_characters():
    assert _safe_dirname('Mix: "2026"/Live?') == "Mix_ _2026__Live_"


def test_safe_dirname_handles_empty_names():
    assert _safe_dirname("   ...   ") == "sin_nombre"


def test_safe_join_rejects_parent_traversal(tmp_path):
    with pytest.raises(ValueError):
        _safe_join(str(tmp_path), "../outside.mp3")


def test_safe_join_accepts_child_path(tmp_path):
    result = _safe_join(str(tmp_path), "nested/file.mp3")
    assert result.endswith("nested\\file.mp3")


def test_completed_search_uses_is_complete_flag():
    from backend.slskd_client import SlskdClient

    result = SlskdClient.normalize_search({
        "id": "search-1",
        "searchText": "artist - title",
        "state": "Searching",
        "isComplete": True,
        "responses": [],
    })

    assert result["status"] == "completed"


def test_transfer_error_detects_offline_user():
    from backend.slskd_client import SlskdClient

    response = SimpleNamespace(
        status_code=500,
        text="The user appears to be offline",
        json=lambda: {"error": "The user appears to be offline"},
    )

    assert SlskdClient.classify_transfer_error(response) == {
        "status": "offline",
        "error": "El usuario de Soulseek está desconectado",
    }


def test_transfer_error_keeps_generic_errors_generic():
    from backend.slskd_client import SlskdClient

    response = SimpleNamespace(
        status_code=500,
        text="Unexpected transfer error",
        json=lambda: {"error": "Unexpected transfer error"},
    )

    assert SlskdClient.classify_transfer_error(response) == {
        "status": "error",
        "error": "slskd 500",
    }
