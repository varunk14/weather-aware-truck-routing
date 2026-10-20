"""Production configuration is checked in a subprocess, since settings load once per process."""

import os
import secrets
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def run_manage(*args: str, **env: str) -> subprocess.CompletedProcess[str]:
    base_env = {
        key: value for key, value in os.environ.items() if not key.startswith(("DJANGO_", "CORS_"))
    }
    return subprocess.run(
        [sys.executable, "manage.py", *args],
        cwd=BACKEND_DIR,
        env={**base_env, "DJANGO_SETTINGS_MODULE": "config.settings.prod", **env},
        capture_output=True,
        text=True,
        check=False,
    )


def test_production_settings_pass_django_deploy_checks() -> None:
    result = run_manage(
        "check",
        "--deploy",
        "--fail-level",
        "WARNING",
        DJANGO_SECRET_KEY=secrets.token_urlsafe(64),
        DJANGO_ALLOWED_HOSTS="api.example.com",
        CORS_ALLOWED_ORIGINS="https://app.example.com",
    )

    assert result.returncode == 0, result.stderr


def test_production_settings_refuse_to_start_without_a_secret_key() -> None:
    result = run_manage(
        "check",
        DJANGO_ALLOWED_HOSTS="api.example.com",
        CORS_ALLOWED_ORIGINS="https://app.example.com",
    )

    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY" in result.stderr
