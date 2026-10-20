from datetime import datetime

from django.test import Client

from config import __version__


def test_health_reports_ok_with_version_and_time(client: Client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response["Content-Type"] == "application/json"
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
    assert datetime.fromisoformat(body["time"]).tzinfo is not None


def test_health_only_allows_get(client: Client) -> None:
    response = client.post("/api/health", data={}, content_type="application/json")

    assert response.status_code == 405


def test_unknown_api_route_returns_404(client: Client) -> None:
    assert client.get("/api/does-not-exist").status_code == 404


def test_cors_allows_configured_origin(client: Client) -> None:
    response = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )

    assert response["Access-Control-Allow-Origin"] == "http://localhost:5173"


def test_cors_ignores_unknown_origin(client: Client) -> None:
    response = client.get("/api/health", headers={"Origin": "https://example.com"})

    assert "Access-Control-Allow-Origin" not in response
