"""Local development settings."""

from config.env import env_list, env_str
from config.settings.base import *  # noqa: F403

DEBUG = True

SECRET_KEY = env_str("DJANGO_SECRET_KEY", "django-insecure-local-development-only")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1"])

CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS", ["http://localhost:5173", "http://127.0.0.1:5173"]
)
