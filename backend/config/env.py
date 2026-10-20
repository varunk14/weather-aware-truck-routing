"""Typed access to environment variables used by the settings modules."""

import os

from django.core.exceptions import ImproperlyConfigured

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def env_str(name: str, default: str | None = None) -> str:
    """Return a non-empty string variable, or ``default`` when unset.

    Raises ``ImproperlyConfigured`` when the variable is missing or empty and no
    default is given, so misconfiguration fails at startup rather than at request time.
    """
    value = os.environ.get(name, "").strip()
    if value:
        return value
    if default is None:
        raise ImproperlyConfigured(f"Environment variable {name} is required.")
    return default


def env_bool(name: str, *, default: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ImproperlyConfigured(f"Environment variable {name} must be a boolean, got {value!r}.")


def env_list(name: str, default: list[str] | None = None) -> list[str]:
    """Return a comma-separated variable as a list of non-empty, stripped items."""
    raw = os.environ.get(name, "")
    items = [item.strip() for item in raw.split(",") if item.strip()]
    if items:
        return items
    if default is None:
        raise ImproperlyConfigured(f"Environment variable {name} is required.")
    return default
