from fastapi.testclient import TestClient

from app.main import app


def test_health_and_openapi_start_without_database_or_provider():
    with TestClient(app) as client:
        assert client.get("/api/v1/health").json()["status"] == "ok"
        schema = client.get("/openapi.json").json()
        assert "/api/v1/conversations/{conversation_id}/stream" in schema["paths"]
        assert "/api/v1/agents/runs/{run_id}/approve" in schema["paths"]


def test_missing_auth_is_rejected_before_database_read():
    with TestClient(app) as client:
        response = client.get("/api/v1/documents", headers={"X-Workspace-Id": "other"})
        assert response.status_code == 401


def test_validation_does_not_echo_sensitive_payload():
    secret = "a-secret-password"
    with TestClient(app) as client:
        response = client.post("/api/v1/auth/login", json={"email": "bad", "password": secret})
        assert response.status_code == 422
        assert secret not in response.text
