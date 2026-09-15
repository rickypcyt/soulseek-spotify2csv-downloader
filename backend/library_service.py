"""Library track bookkeeping and playlist-name helpers.

Wraps the per-user SQLite database access for library tracks plus the small
helpers that read the playlist name produced by the CSV converter.
"""

from __future__ import annotations

import base64
import os
from typing import TYPE_CHECKING
from urllib.parse import quote

from mutagen import File as MutagenFile
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, ID3NoHeaderError, TALB, TBPM, TIT2, TPE1
from mutagen.mp4 import AtomDataType, MP4, MP4Cover

from backend.database import (
    move_library_path as _move_database_path,
)
from backend.database import (
    register_library_track as _register_database_track,
)
from backend.database import (
    remove_library_paths as _remove_database_paths,
)
from backend.database import update_library_bpm as _update_database_bpm
from backend.database import update_library_metadata_by_path as _update_database_metadata

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


_AUDIO_SUFFIXES = {".mp3", ".flac", ".m4a", ".mp4", ".ogg", ".oga", ".opus", ".aac", ".wav"}


def is_audio_path(path: str) -> bool:
    return os.path.splitext(path.lower())[1] in _AUDIO_SUFFIXES


def _image_mime(data: bytes, fallback: str = "image/jpeg") -> str:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data.startswith(b"GIF8"):
        return "image/gif"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return fallback


def extract_embedded_cover(path: str) -> tuple[bytes, str] | None:
    try:
        audio = MutagenFile(path)
    except Exception:
        return None
    if audio is None:
        return None

    pictures = getattr(audio, "pictures", None) or []
    if pictures:
        picture = pictures[0]
        data = bytes(picture.data)
        if data:
            return data, picture.mime or _image_mime(data)

    tags = getattr(audio, "tags", None)
    if not tags:
        return None

    apic_tags = tags.getall("APIC") if hasattr(tags, "getall") else []
    if apic_tags:
        picture = apic_tags[0]
        data = bytes(picture.data)
        if data:
            return data, picture.mime or _image_mime(data)

    metadata_picture = tags.get("metadata_block_picture")
    if metadata_picture:
        encoded = metadata_picture[0] if isinstance(metadata_picture, list) else metadata_picture
        try:
            picture = Picture(base64.b64decode(encoded))
            data = bytes(picture.data)
            if data:
                return data, picture.mime or _image_mime(data)
        except Exception:
            pass

    covers = tags.get("covr")
    if covers:
        data = bytes(covers[0])
        if data:
            return data, _image_mime(data)

    return None


def write_audio_metadata(path: str, track_name: str, artists: str, album: str = "") -> None:
    suffix = os.path.splitext(path.lower())[1]
    if suffix == ".mp3":
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
        tags.delall("TIT2")
        tags.delall("TPE1")
        tags.add(TIT2(encoding=3, text=track_name))
        tags.add(TPE1(encoding=3, text=artists))
        if album:
            tags.delall("TALB")
            tags.add(TALB(encoding=3, text=album))
        tags.save(path)
        return
    if suffix == ".flac":
        audio = FLAC(path)
        audio["TITLE"] = track_name
        audio["ARTIST"] = artists
        if album:
            audio["ALBUM"] = album
        audio.save()
        return
    if suffix in {".m4a", ".mp4"}:
        audio = MP4(path)
        audio["\xa9nam"] = [track_name]
        audio["\xa9ART"] = [artists]
        if album:
            audio["\xa9alb"] = [album]
        audio.save()
        return
    if suffix in {".ogg", ".oga", ".opus"}:
        audio = MutagenFile(path)
        if audio is None:
            raise ValueError("No se pudo abrir el archivo de audio")
        audio["TITLE"] = [track_name]
        audio["ARTIST"] = [artists]
        if album:
            audio["ALBUM"] = [album]
        audio.save()
        return
    raise ValueError("Formato de audio no compatible para editar metadata")


def write_bpm(path: str, bpm: float) -> None:
    value = str(round(float(bpm), 2))
    suffix = os.path.splitext(path.lower())[1]
    if suffix == ".mp3":
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
        tags.delall("TBPM")
        tags.add(TBPM(encoding=3, text=value))
        tags.save(path)
        return
    if suffix == ".flac":
        audio = FLAC(path)
        audio["BPM"] = value
        audio.save()
        return
    if suffix in {".m4a", ".mp4"}:
        audio = MP4(path)
        audio["tmpo"] = [int(round(float(bpm)))]
        audio.save()
        return
    if suffix in {".ogg", ".oga", ".opus"}:
        audio = MutagenFile(path)
        if audio is None:
            raise ValueError("No se pudo abrir el archivo de audio")
        audio["BPM"] = value
        audio.save()
        return
    raise ValueError("Formato de audio no compatible para insertar BPM")


def embed_cover(path: str, data: bytes, mime: str) -> None:
    suffix = os.path.splitext(path.lower())[1]
    if suffix == ".mp3":
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
        tags.delall("APIC")
        tags.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=data))
        tags.save(path)
        return

    if suffix == ".flac":
        audio = FLAC(path)
        audio.clear_pictures()
        picture = Picture()
        picture.type = 3
        picture.mime = mime
        picture.desc = "Cover"
        picture.data = data
        audio.add_picture(picture)
        audio.save()
        return

    if suffix in {".m4a", ".mp4"}:
        audio = MP4(path)
        image_format = AtomDataType.PNG if mime == "image/png" else AtomDataType.JPEG
        audio["covr"] = [MP4Cover(data, imageformat=image_format)]
        audio.save()
        return

    if suffix in {".ogg", ".oga", ".opus"}:
        audio = MutagenFile(path)
        if audio is None:
            raise ValueError("No se pudo abrir el archivo de audio")
        picture = Picture()
        picture.type = 3
        picture.mime = mime
        picture.desc = "Cover"
        picture.data = data
        encoded = base64.b64encode(picture.write()).decode("ascii")
        audio["metadata_block_picture"] = [encoded]
        audio.save()
        return

    raise ValueError("Formato de audio no compatible para insertar portada")


class LibraryService:
    def __init__(self, state: RuntimeState) -> None:
        self.state = state

    def playlist_name(self) -> str:
        path = self.state.settings.playlist_name_file
        if not os.path.exists(path):
            return ""
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            return ""

    def _get_field(self, audio, *names) -> str:
        if audio is None:
            return ""
        for name in names:
            try:
                value = audio.get(name)
                if value is None:
                    continue
                if hasattr(value, "text"):
                    value = value.text
                if isinstance(value, list):
                    value = value[0] if value else ""
                text = str(value).strip()
                if text:
                    return text
            except Exception:
                continue
        return ""

    def index(self) -> dict[str, dict[str, str]]:
        root = self.state.current_downloads_dir
        index: dict[str, dict[str, str]] = {}
        if not os.path.isdir(root):
            return index
        for directory, _, names in os.walk(root):
            for name in names:
                full = os.path.join(directory, name)
                rel = os.path.relpath(full, root).replace("\\", "/")
                if rel.split("/")[0].lower() in {"temp", ".incomplete"} or not is_audio_path(rel):
                    continue
                try:
                    audio = MutagenFile(full)
                    title = self._get_field(audio, "TIT2", "TITLE", "\xa9nam")
                    artist = self._get_field(audio, "TPE1", "ARTIST", "\xa9ART")
                    album = self._get_field(audio, "TALB", "ALBUM", "\xa9alb")
                except Exception:
                    audio = None
                    title = ""
                    artist = ""
                    album = ""
                if not title:
                    title = os.path.splitext(name)[0]
                cover_url = f"/api/library/cover?path={quote(rel, safe='')}"
                index[f"file:{rel}"] = {
                    "track_key": f"file:{rel}",
                    "track_name": title,
                    "artists": artist,
                    "album": album,
                    "path": rel,
                    "cover_url": cover_url,
                    "cover_source_url": cover_url,
                }
        return index

    def register_track(self, track_key, track_name, artists, path, cover_url="") -> None:
        _register_database_track(track_key, track_name, artists, path, cover_url)

    def move_path(self, old_path: str, new_path: str) -> None:
        _move_database_path(old_path, new_path)

    def update_bpm(self, track_key: str, bpm: float) -> None:
        _update_database_bpm(track_key, bpm)

    def update_metadata(self, path: str, track_name: str, artists: str) -> None:
        _update_database_metadata(path, track_name, artists)

    def remove_paths(self, path: str) -> None:
        _remove_database_paths(path)
