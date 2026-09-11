from pathlib import Path

from backend.backend_config import BackendSettings


def test_backend_settings_use_ui_defaults(monkeypatch):
    monkeypatch.setenv("SLSKD_DOWNLOADS_DIR", "C:/ignored/downloads")
    monkeypatch.setenv("SLSKD_API_KEY", "ignored")
    settings = BackendSettings.from_environment(Path("C:/project"))

    assert settings.script_dir == Path("C:/project")
    assert settings.downloads_dir == Path.home() / "Music" / "Soulseek Downloads"
    assert settings.previews_dir == settings.downloads_dir / "temp"
    assert settings.use_slskd is False
    assert settings.dist_dir == Path("C:/project/frontend/dist")
