from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_risk_graph_mock_payload_shape() -> None:
    response = client.post(
        "/risk/graph",
        json={
            "user_id": "marcus",
            "recipient_id": "investment_agent",
            "amount": 1000,
            "currency": "MYR",
            "channel": "wallet_app",
            "message": "guaranteed return investment, transfer immediately",
            "recipient_is_new": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision"] in {"APPROVED", "WARNING", "INTERVENTION_REQUIRED"}
    assert isinstance(body["risk_score"], int)
    assert isinstance(body["nodes"], list)
    assert isinstance(body["edges"], list)
    assert body["stats"]["source"] in {"mock", "neptune", "error", "none", "unknown"}
