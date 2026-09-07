import pytest

from spotify_to_csv import parse_spotify_id


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
