"""Production settings. Every value that differs per deployment comes from the environment."""

from config.env import env_list, env_str
from config.settings.base import *  # noqa: F403

DEBUG = False

SECRET_KEY = env_str("DJANGO_SECRET_KEY")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")

# TLS is terminated by the hosting platform's proxy.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
# The platform's internal health check calls the service over plain HTTP.
SECURE_REDIRECT_EXEMPT = [r"^api/health$"]
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"

# One proxy sits in front of the app; rate limits use the client address it forwards.
REST_FRAMEWORK = {**REST_FRAMEWORK, "NUM_PROXIES": 1}  # noqa: F405

# HSTS preload lists accept registrable domains only; the API runs on a platform subdomain.
SILENCED_SYSTEM_CHECKS = ["security.W021"]
