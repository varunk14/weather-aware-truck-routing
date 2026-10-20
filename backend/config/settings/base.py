"""Settings shared by every environment.

The API is stateless: there are no user accounts and nothing is persisted, so no
database is configured. Responses from third-party services are cached in memory.
"""

from pathlib import Path
from typing import Any

from config.env import env_str

BASE_DIR = Path(__file__).resolve().parent.parent.parent

INSTALLED_APPS = [
    "corsheaders",
    "rest_framework",
    "routing",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES: dict[str, dict[str, str]] = {}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "clearway",
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

REST_FRAMEWORK: dict[str, Any] = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "routing.api_errors.exception_handler",
    # Per client IP; protects the TomTom quota. Suggestions fire while typing.
    "DEFAULT_THROTTLE_RATES": {"suggest": "60/min", "routes": "10/min"},
}

# Routing and geocoding. Optional so the API starts without it; routing endpoints then
# answer 503 until it is set.
TOMTOM_API_KEY = env_str("TOMTOM_API_KEY", "")

CORS_ALLOW_METHODS = ["GET", "POST", "OPTIONS"]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    "root": {"handlers": ["console"], "level": env_str("DJANGO_LOG_LEVEL", "INFO")},
    # httpx logs full request URLs at INFO, and TomTom routing URLs contain the API key.
    "loggers": {
        "httpx": {"level": "WARNING"},
        "httpcore": {"level": "WARNING"},
    },
}
