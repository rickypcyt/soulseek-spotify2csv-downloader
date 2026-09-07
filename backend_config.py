import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BackendSettings:
    script_dir: Path
    dist_dir: Path
    run_script: Path
    csv_output: Path
    playlist_name_file: Path
    previews_dir: Path
    downloads_dir: Path
    config_file: Path
    logs_file: Path
    slskd_url: str
    slskd_key: str

    @property
    def use_slskd(self) -> bool:
        return bool(self.slskd_key)

    @classmethod
    def from_environment(cls, script_dir: Path | None = None) -> "BackendSettings":
        root = script_dir or Path(__file__).resolve().parent
        default_downloads = Path.home() / "Music" / "Soulseek Downloads"
        return cls(
            script_dir=root,
            dist_dir=root / "spotify-soulseek-web" / "dist",
            run_script=root / "run.ps1",
            csv_output=root / "web_output.csv",
            playlist_name_file=root / "web_playlist_name.txt",
            previews_dir=root / "previews",
            downloads_dir=Path(os.getenv("SLSKD_DOWNLOADS_DIR") or default_downloads),
            config_file=root / "web_config.json",
            logs_file=root / "web_logs.json",
            slskd_url=os.getenv("SLSKD_URL", "http://127.0.0.1:5030"),
            slskd_key=os.getenv("SLSKD_API_KEY", ""),
        )
