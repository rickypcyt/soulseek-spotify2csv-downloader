import argparse
import csv
import logging
import os
import re
import sys
import webbrowser

import spotipy

logging.basicConfig(level=logging.INFO, format="%(message)s")
from spotipy.oauth2 import (
    RequestHandler,
    SpotifyClientCredentials,
    SpotifyOAuth,
    start_local_http_server,
)


class CloseableCallbackHandler(RequestHandler):
    """Render a callback page that can close itself when the browser allows it."""

    def _write(self, text):
        text = text.replace(
            "window.close()",
            "window.open('', '_self'); window.close()",
        ).replace(
            "This window can be closed.",
            "Si esta pestaña no se cierra automáticamente, puedes cerrarla de forma segura.",
        ).replace(
            "Close Window",
            "Cerrar ventana",
        )
        return super()._write(text)


class LocalSpotifyOAuth(SpotifyOAuth):
    """Use the improved callback page without modifying the spotipy package."""

    def _open_auth_url(self):
        auth_url = self.get_authorize_url()
        print(f"[spotify] Para autorizar Spotify, abrí este link si no se abre automáticamente: {auth_url}")
        opened = False
        try:
            opened = webbrowser.open(auth_url, new=2, autoraise=True)
        except Exception as exc:
            print(f"[spotify] webbrowser.open falló: {exc}")
        if not opened and sys.platform == "win32":
            try:
                os.startfile(auth_url)
                opened = True
            except Exception as exc:
                print(f"[spotify] os.startfile falló: {exc}")
        return opened

    def _get_auth_response_local_server(self, redirect_port):
        server = start_local_http_server(redirect_port, handler=CloseableCallbackHandler)
        self._open_auth_url()
        while server.auth_code is None and server.error is None:
            server.handle_request()

        if server.error is not None:
            raise server.error
        if self.state is not None and server.state != self.state:
            from spotipy.oauth2 import SpotifyStateError

            raise SpotifyStateError(self.state, server.state)
        if server.auth_code is not None:
            return server.auth_code
        raise RuntimeError("El servidor local de Spotify no recibió la respuesta de autenticación.")


def parse_spotify_id(url):
    """Extrae el tipo y el ID de un link público de Spotify."""
    match = re.search(r"(?:open\.spotify\.com/|spotify:)(track|album|playlist|artist)[/:]([a-zA-Z0-9]+)", url)
    if not match:
        raise ValueError("No se reconoce el link. Usá un link de open.spotify.com o un URI spotify:.")
    return match.group(1), match.group(2)


def fetch_tracks(sp, link_type, link_id):
    """Descarga las pistas según el tipo de link."""
    tracks = []

    if link_type == "track":
        tracks.append(sp.track(link_id))

    elif link_type == "album":
        album = sp.album(link_id)
        album_data = {"name": album.get("name", ""), "images": album.get("images", [])}
        results = sp.album_tracks(link_id)
        for item in results["items"]:
            item["album"] = album_data
            tracks.append(item)
        while results.get("next"):
            results = sp.next(results)
            for item in results["items"]:
                item["album"] = album_data
                tracks.append(item)

    elif link_type == "playlist":
        results = sp.playlist_items(link_id, additional_types=("track",))
        for item in results["items"]:
            track = item.get("track") or item.get("item")
            if isinstance(track, dict):
                tracks.append(track)
        while results.get("next"):
            results = sp.next(results)
            for item in results["items"]:
                track = item.get("track") or item.get("item")
                if isinstance(track, dict):
                    tracks.append(track)

    elif link_type == "artist":
        results = sp.artist_top_tracks(link_id)
        tracks.extend(results["tracks"])

    return tracks


def write_csv(tracks, filename):
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["track_name", "artists", "album", "duration_ms", "spotify_url", "spotify_preview", "search_query", "cover_url"])

        for track in tracks:
            name = track.get("name", "")
            artists = " ".join(a["name"] for a in track.get("artists", []))
            album = track.get("album", {}) if isinstance(track.get("album"), dict) else {}
            album_name = album.get("name", "")
            images = album.get("images", []) if isinstance(album, dict) else []
            cover_url = next(
                (image.get("url", "") for image in images if isinstance(image, dict) and image.get("url")),
                "",
            )
            duration = track.get("duration_ms", "")
            url = track.get("external_urls", {}).get("spotify", "")
            preview = track.get("preview_url", "") or ""
            search_query = f"{artists} {name}".strip()

            writer.writerow([name, artists, album_name, duration, url, preview, search_query, cover_url])


def convert(url: str, output: str, environment: dict[str, str] | None = None) -> None:
    if environment is not None:
        os.environ.update(environment)

    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")

    if not client_id or not client_secret:
        raise RuntimeError(
            "Faltan las credenciales de Spotify. "
            "Registrá una app gratuita en https://developer.spotify.com/dashboard "
            "y exportá SPOTIPY_CLIENT_ID y SPOTIPY_CLIENT_SECRET."
        )

    link_type, link_id = parse_spotify_id(url)

    if link_type == "playlist":
        redirect_uri = os.getenv("SPOTIPY_REDIRECT_URI", "http://127.0.0.1:8080/callback")
        auth_manager = LocalSpotifyOAuth(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scope="playlist-read-private playlist-read-collaborative",
            open_browser=True,
        )
    else:
        auth_manager = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)

    sp = spotipy.Spotify(auth_manager=auth_manager)

    print(f"Descargando {link_type} {link_id}...")
    tracks = fetch_tracks(sp, link_type, link_id)

    if link_type == "playlist":
        name = sp.playlist(link_id).get("name", "")
    elif link_type == "album":
        name = sp.album(link_id).get("name", "")
    elif link_type == "artist":
        name = sp.artist(link_id).get("name", "")
    else:
        name = tracks[0].get("name", "") if tracks else ""

    write_csv(tracks, output)

    name_file = os.path.splitext(output)[0] + "_playlist_name.txt"
    with open(name_file, "w", encoding="utf-8") as f:
        f.write(name)

    print(f"Listo: {output} con {len(tracks)} pista(s).")


def main():
    parser = argparse.ArgumentParser(description="Convierte un link de Spotify en un CSV.")
    parser.add_argument("url", help="Link de Spotify (track, album, playlist o artist).")
    parser.add_argument("-o", "--output", default="spotify_output.csv", help="Nombre del archivo CSV.")
    args = parser.parse_args()
    try:
        convert(args.url, args.output)
    except RuntimeError as exc:
        print(exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
