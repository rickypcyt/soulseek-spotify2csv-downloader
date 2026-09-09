from pathlib import Path

from backend.backend_config import BackendSettings


def test_backend_settings_use_explicit_script_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("SLSKD_DOWNLOADS_DIR", str(tmp_path / "downloads"))
    monkeypatch.setenv("SLSKD_API_KEY", "key")
    settings = BackendSettings.from_environment(Path("C:/project"))

    assert settings.script_dir == Path("C:/project")
    assert settings.downloads_dir == tmp_path / "downloads"
    assert settings.previews_dir == tmp_path / "downloads" / "temp"
    assert settings.use_slskd is True
    assert settings.dist_dir == Path("C:/project/frontend/dist")
