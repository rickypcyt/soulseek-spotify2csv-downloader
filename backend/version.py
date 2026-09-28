"""Single source of truth for the application version.

The release workflow stamps this value from the git tag before packaging,
so released builds always report the tag they were built from.
"""

APP_VERSION = "1.0.0"
