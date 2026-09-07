import argparse
import csv
import logging
import os
import re
import sys

import spotipy

logging.basicConfig(level=logging.INFO, format="%(message)s")
from spotipy.oauth2 import SpotifyClientCredentials, SpotifyOAuth


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
        album_name = sp.album(link_id)["name"]
        results = sp.album_tracks(link_id)
        for item in results["items"]:
            item["album"] = {"name": album_name}
            tracks.append(item)
        while results.get("next"):
            results = sp.next(results)
            for item in results["items"]:
                item["album"] = {"name": album_name}
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
        writer.writerow(["track_name", "artists", "album", "duration_ms", "spotify_url", "spotify_preview", "search_query"])

        for track in tracks:
            name = track.get("name", "")
            artists = " ".join(a["name"] for a in track.get("artists", []))
            album = track.get("album", {}).get("name", "") if isinstance(track.get("album"), dict) else ""
            duration = track.get("duration_ms", "")
            url = track.get("external_urls", {}).get("spotify", "")
            preview = track.get("preview_url", "") or ""
            search_query = f"{artists} {name}".strip()

            writer.writerow([name, artists, album, duration, url, preview, search_query])


def main():
    parser = argparse.ArgumentParser(description="Convierte un link de Spotify en un CSV.")
    parser.add_argument("url", help="Link de Spotify (track, album, playlist o artist).")
    parser.add_argument("-o", "--output", default="spotify_output.csv", help="Nombre del archivo CSV.")
    args = parser.parse_args()

    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")

    if not client_id or not client_secret:
        print("Faltan las credenciales de Spotify.")
        print("Registrá una app gratuita en https://developer.spotify.com/dashboard")
        print("y exportá SPOTIPY_CLIENT_ID y SPOTIPY_CLIENT_SECRET.")
        sys.exit(1)

    link_type, link_id = parse_spotify_id(args.url)

    if link_type == "playlist":
        redirect_uri = os.getenv("SPOTIPY_REDIRECT_URI", "http://127.0.0.1:8080/callback")
        auth_manager = SpotifyOAuth(
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

    write_csv(tracks, args.output)

    name_file = os.path.splitext(args.output)[0] + "_playlist_name.txt"
    with open(name_file, "w", encoding="utf-8") as f:
        f.write(name)

    print(f"Listo: {args.output} con {len(tracks)} pista(s).")


if __name__ == "__main__":
    main()
