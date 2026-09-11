from pathlib import Path
from typing import Any

from backend.database import DB_PATH, get_settings, initialize_database, update_settings

try:
    import keyring
except ImportError:  # pragma: no cover - se instala en el entorno de la aplicación
    keyring = None


SERVICE_NAME = "spotify-soulseek"
SECRET_NAMES = {
    "spotify_client_secret": "SPOTIPY_CLIENT_SECRET",
    "slskd_api_key": "SLSKD_API_KEY",
    "soulseek_username": "SLSK_USERNAME",
    "soulseek_password": "SLSK_PASSWORD",
}


class LocalConfigStore:
    """Stores public settings in the per-user SQLite database and secrets in keyring."""

    def __init__(self, config_path: Path):
        self.config_path = Path(config_path)
        self.db_path = DB_PATH if self.config_path.name == "web_config.json" else self.config_path.with_suffix(".db")
        initialize_database(
            legacy_root=self.config_path.parent if self.config_path.name == "web_config.json" else None,
            db_path=self.db_path,
        )

    def _get_secret(self, name: str) -> str:
        if keyring is not None:
            try:
                value = keyring.get_password(SERVICE_NAME, name)
                if value:
                    return value
            except Exception:
                pass
        return ""

    def _set_secret(self, name: str, value: str) -> None:
        if keyring is None:
            raise RuntimeError("No está disponible el almacén seguro del sistema.")
        keyring.set_password(SERVICE_NAME, name, value)

    def get(self) -> dict[str, Any]:
        public = get_settings(self.db_path)
        result = {
            "spotify_client_id": public.get("spotify_client_id", ""),
            "spotify_redirect_uri": public.get("spotify_redirect_uri", "http://127.0.0.1:8080/callback"),
            "provider": "slskd",
            "slskd_url": public.get("slskd_url", "http://127.0.0.1:5030"),
            "soulseek_username": self._get_secret("soulseek_username") or public.get("soulseek_username", ""),
            "downloads_dir": public.get("downloads_dir", ""),
            "slskd_path": public.get("slskd_path", ""),
        }
        for name in SECRET_NAMES:
            result[f"{name}_configured"] = bool(self._get_secret(name))
        return result

    def get_secret(self, name: str) -> str:
        if name not in SECRET_NAMES:
            raise ValueError(f"Secreto no soportado: {name}")
        return self._get_secret(name)

    def update(self, values: dict[str, Any]) -> dict[str, Any]:
        public_keys = {
            "spotify_client_id",
            "spotify_redirect_uri",
            "slskd_url",
            "downloads_dir",
            "slskd_path",
        }
        public_values = {
            key: str(values[key]).strip()
            for key in public_keys
            if key in values and values[key] is not None
        }
        update_settings(public_values, self.db_path)

        for name in SECRET_NAMES:
            if name in values and values[name] is not None:
                self._set_secret(name, str(values[name]))
        return self.get()
