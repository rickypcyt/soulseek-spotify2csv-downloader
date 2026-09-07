from typing import ClassVar

from local_config import LocalConfigStore


class FakeKeyring:
    values: ClassVar[dict[tuple[str, str], str]] = {}

    @classmethod
    def get_password(cls, service, name):
        return cls.values.get((service, name))

    @classmethod
    def set_password(cls, service, name, value):
        cls.values[(service, name)] = value


def test_local_config_keeps_secrets_out_of_public_json(tmp_path, monkeypatch):
    import local_config

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
    assert "spotify_client_secret" not in (tmp_path / "config.json").read_text()
    assert "soulseek_password" not in (tmp_path / "config.json").read_text()
    assert store.get_secret("spotify_client_secret") == "secret"
