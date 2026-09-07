import pytest

from spotify_web import _safe_dirname, _safe_join


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
