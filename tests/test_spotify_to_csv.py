import pytest

from backend.spotify_to_csv import parse_spotify_id, write_csv


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://open.spotify.com/playlist/abc123", ("playlist", "abc123")),
        ("https://open.spotify.com/album/abc123?si=test", ("album", "abc123")),
        ("spotify:track:abc123", ("track", "abc123")),
        ("spotify:artist:abc123", ("artist", "abc123")),
    ],
)
def test_parse_spotify_id(url, expected):
    assert parse_spotify_id(url) == expected


def test_parse_spotify_id_rejects_unknown_url():
    with pytest.raises(ValueError):
        parse_spotify_id("https://example.com/not-spotify")


def test_write_csv_preserves_album_cover_url(tmp_path):
    output = tmp_path / "tracks.csv"
    write_csv([{
        "name": "Track",
        "artists": [{"name": "Artist"}],
        "album": {
            "name": "Album",
            "images": [{"url": "https://i.scdn.co/image/cover"}],
        },
        "duration_ms": 180000,
        "external_urls": {"spotify": "https://open.spotify.com/track/id"},
    }], output)

    assert "https://i.scdn.co/image/cover" in output.read_text(encoding="utf-8")
