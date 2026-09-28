from backend.updater import is_newer, parse_version


def test_parse_version_strips_v_prefix():
    assert parse_version("v1.2.3") == (1, 2, 3)


def test_parse_version_ignores_suffixes():
    assert parse_version("1.2.3-beta") == (1, 2, 3)


def test_parse_version_handles_garbage():
    assert parse_version("notaversion") == (0,)


def test_is_newer_compares_semver():
    assert is_newer("v1.2.0", "1.1.9")
    assert is_newer("1.10.0", "1.9.9")
    assert not is_newer("1.0.0", "1.0.0")
    assert not is_newer("v0.9.0", "1.0.0")


def test_is_newer_pads_different_lengths():
    assert is_newer("1.0.1", "1.0")
    assert not is_newer("1.0", "1.0.1")
