import sqlite3
from typing import ClassVar

from backend.local_config import LocalConfigStore


class FakeKeyring:
    values: ClassVar[dict[tuple[str, str], str]] = {}

    @classmethod
    def get_password(cls, service, name):
        return cls.values.get((service, name))

    @classmethod
    def set_password(cls, service, name, value):
        cls.values[(service, name)] = value


def test_local_config_keeps_secrets_out_of_sqlite(tmp_path, monkeypatch):
    from backend import local_config

    monkeypatch.setattr(local_config, "keyring", FakeKeyring)
    store = LocalConfigStore(tmp_path / "config.json")
    saved = store.update({
        "spotify_client_id": "client",
        "spotify_client_secret": "secret",
        "soulseek_username": "user",
        "soulseek_password": "password",
    })

    assert saved["spotify_client_id"] == "client"
    assert saved["soulseek_username"] == "user"
    assert saved["soulseek_password_configured"] is True
    with sqlite3.connect(tmp_path / "config.db") as connection:
        public_keys = {row[0] for row in connection.execute("SELECT key FROM settings")}
    assert "spotify_client_secret" not in public_keys
    assert "soulseek_password" not in public_keys
    assert store.get_secret("spotify_client_secret") == "secret"
