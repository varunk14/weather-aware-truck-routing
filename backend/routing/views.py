import hashlib
from dataclasses import asdict

from django.core.cache import cache
from django.utils import timezone
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config import __version__
from routing import clients
from routing.serializers import TripRequestSerializer, plan_to_json
from routing.services.planner import SamePlaceError, plan_trip
from routing.throttles import RoutesThrottle, SuggestThrottle

SUGGEST_MIN_CHARS = 2
SUGGEST_MAX_CHARS = 100
SUGGEST_CACHE_S = 24 * 60 * 60


class HealthView(APIView):
    """Liveness probe for the hosting platform, the uptime monitor and the frontend."""

    def get(self, request: Request) -> Response:
        return Response(
            {
                "status": "ok",
                "version": __version__,
                "time": timezone.now().isoformat(),
            }
        )


class PlaceSuggestView(APIView):
    """Place suggestions while the user types an origin or destination."""

    throttle_classes = (SuggestThrottle,)

    def get(self, request: Request) -> Response:
        query = request.query_params.get("q", "").strip()
        if len(query) > SUGGEST_MAX_CHARS:
            raise serializers.ValidationError(
                {"q": [f"Use at most {SUGGEST_MAX_CHARS} characters."]}
            )
        if len(query) < SUGGEST_MIN_CHARS:
            return Response({"results": []})

        key = "suggest:" + hashlib.sha256(query.casefold().encode()).hexdigest()
        results = cache.get(key)
        if results is None:
            results = [asdict(s) for s in clients.tomtom_client().suggest(query)]
            cache.set(key, results, SUGGEST_CACHE_S)
        return Response({"results": results})


class RoutesView(APIView):
    """Three truck route options, each with checkpoints and estimated arrival times."""

    throttle_classes = (RoutesThrottle,)

    def post(self, request: Request) -> Response:
        serializer = TripRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            plan = plan_trip(clients.tomtom_client(), serializer.to_trip())
        except SamePlaceError as error:
            raise serializers.ValidationError({"destination": [str(error)]}) from error
        return Response(plan_to_json(plan))
