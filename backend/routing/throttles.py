"""Per-client rate limits that protect the TomTom quota on a public deployment."""

from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView


class ClientRateThrottle(SimpleRateThrottle):
    """Limits requests per client IP address, for every caller (there are no accounts)."""

    def get_cache_key(self, request: Request, view: APIView) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class SuggestThrottle(ClientRateThrottle):
    scope = "suggest"


class RoutesThrottle(ClientRateThrottle):
    scope = "routes"
