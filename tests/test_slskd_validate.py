"""Tests for SlskdClient.validate_credentials (Soulseek credential check)."""

from types import SimpleNamespace
from typing import ClassVar

from backend.slskd_client import SlskdClient


class FakeConfigStore:
    def __init__(self, secrets=None, public=None):
        self._secrets = secrets or {}
        self._public = public or {}

    def get(self):
        return dict(self._public)

    def get_secret(self, name):
        return self._secrets.get(name, "")

    def update(self, values):
        return self.get()


class FakeLogs:
    def add(self, *args, **kwargs):
        pass


class FakeProcess:
    """A live process stub: poll() -> None means 'still running'."""

    terminated: ClassVar[bool] = False

    def poll(self):
        return None

    def terminate(self):
        pass

    def wait(self, timeout=None):
        return 0


def make_client(secrets=None, public=None):
    state = SimpleNamespace(
        settings=SimpleNamespace(slskd_url="http://slskd.local"),
        config_store=FakeConfigStore(secrets, public),
        logs=FakeLogs(),
        previews_dir="",
        current_downloads_dir="",
    )
    return SlskdClient(state)


def test_validate_missing_credentials():
    client = make_client()  # sin secretos guardados
    result = client.validate_credentials()
    assert result["ok"] is False
    assert result["status"] == "missing"


def test_validate_valid_when_logged_in(monkeypatch):
    client = make_client({"soulseek_username": "u", "soulseek_password": "p"})
    # slskd externo: el proceso no es nuestro pero la API responde.
    monkeypatch.setattr(client, "reachable", lambda: True)
    monkeypatch.setattr(client, "reconnect_server", lambda: True)
    monkeypatch.setattr(client, "server_state", lambda: {"state": "Connected, LoggedIn", "isLoggedIn": True})

    result = client.validate_credentials()

    assert result["ok"] is True
    assert result["status"] == "valid"


def test_validate_invalid_when_connected_but_login_rejected(monkeypatch):
    client = make_client({"soulseek_username": "u", "soulseek_password": "p"})
    monkeypatch.setattr(client, "reachable", lambda: True)
    monkeypatch.setattr(client, "reconnect_server", lambda: True)
    # TCP alcanzado ("Connected") pero el login nunca completa.
    monkeypatch.setattr(client, "server_state", lambda: {"state": "Connected", "isConnected": True})

    result = client.validate_credentials(timeout_seconds=0.2)

    assert result["ok"] is False
    assert result["status"] == "invalid"


def test_validate_unreachable_when_never_connected(monkeypatch):
    client = make_client({"soulseek_username": "u", "soulseek_password": "p"})
    monkeypatch.setattr(client, "reachable", lambda: True)
    monkeypatch.setattr(client, "reconnect_server", lambda: True)
    monkeypatch.setattr(client, "server_state", lambda: {"state": "Disconnected"})

    result = client.validate_credentials(timeout_seconds=0.2)

    assert result["ok"] is False
    assert result["status"] == "unreachable"


def test_validate_restarts_managed_process_with_new_credentials(monkeypatch):
    client = make_client({"soulseek_username": "old", "soulseek_password": "oldpass"})
    client.process = FakeProcess()
    calls = []
    monkeypatch.setattr(client, "stop", lambda: calls.append("stop"))
    monkeypatch.setattr(
        client,
        "start_from_config",
        lambda u=None, p=None: calls.append(("start", u, p)) or True,
    )
    monkeypatch.setattr(client, "reachable", lambda: True)
    monkeypatch.setattr(client, "reconnect_server", lambda: True)
    monkeypatch.setattr(client, "server_state", lambda: {"state": "Connected, LoggedIn", "isLoggedIn": True})

    result = client.validate_credentials("new", "newpass", timeout_seconds=1)

    assert result["status"] == "valid"
    assert calls[:2] == ["stop", ("start", "new", "newpass")]


def test_validate_skips_restart_when_credentials_unchanged(monkeypatch):
    client = make_client({"soulseek_username": "u", "soulseek_password": "p"})
    client.process = FakeProcess()
    client._running_credentials = ("u", "p")
    calls = []
    monkeypatch.setattr(client, "stop", lambda: calls.append("stop"))
    monkeypatch.setattr(client, "reachable", lambda: True)
    monkeypatch.setattr(client, "reconnect_server", lambda: calls.append("reconnect") or True)
    monkeypatch.setattr(client, "server_state", lambda: {"state": "Connected, LoggedIn", "isLoggedIn": True})

    result = client.validate_credentials("u", "p", timeout_seconds=1)

    assert result["status"] == "valid"
    assert "stop" not in calls
    assert "reconnect" in calls
