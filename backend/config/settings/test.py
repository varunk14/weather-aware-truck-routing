"""Settings for the automated test suite."""

from config.settings.base import *  # noqa: F403

DEBUG = False
SECRET_KEY = "test-only"  # noqa: S105 - placeholder used only by the test suite
ALLOWED_HOSTS = ["testserver"]
CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]
