"""Smoke test do /health."""

from fastapi.testclient import TestClient

from src.main import app


def test_health() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "service": "chat"}
