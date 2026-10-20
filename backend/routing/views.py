from django.utils import timezone
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config import __version__


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
