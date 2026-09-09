from backend.spotify_service import read_tracks


def test_read_tracks_accepts_string_path(tmp_path):
    csv_path = tmp_path / "tracks.csv"
    csv_path.write_text("track_name,artists\nSong,Artist\n", encoding="utf-8")

    assert read_tracks(str(csv_path)) == [{"track_name": "Song", "artists": "Artist"}]
