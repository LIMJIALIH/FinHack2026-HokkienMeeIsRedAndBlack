import json

from transaction_agent.agent import (
    LLMTransferDecision,
    MainAgentRuntime,
    _response_from_agent_decision,
)
from transaction_agent.graph_tools import search_contact_nodes_tool


def test_risky_decision_without_warning_id_fails_closed(monkeypatch) -> None:
    def fake_submit(**kwargs):
        return {"decision": "WARNING"}

    monkeypatch.setattr("transaction_agent.agent.submit_llm_transfer_decision_tool", fake_submit)

    decision = LLMTransferDecision(
        mode="transfer_decision",
        assistant_text="Please review this transfer.",
        recipient_id="ali",
        amount=50.0,
        decision="WARNING",
    )
    result = _response_from_agent_decision(
        agent=MainAgentRuntime(agent=None),
        agent_decision=decision,
        steps=[],
        source_text="send rm50 to ali",
        thread_id="thread-1",
        user_id="marcus",
    )

    assert result["result"]["backend_status"] == "ERROR"
    assert "not finalized" in result["result"]["assistant_text"]
    assert result["hitl"] is None


def test_submit_llm_decision_uses_explicit_user_id(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_submit(**kwargs):
        captured["user_id"] = kwargs["user_id"]
        return {"decision": "APPROVED"}

    monkeypatch.setattr("transaction_agent.agent.submit_llm_transfer_decision_tool", fake_submit)

    decision = LLMTransferDecision(
        mode="transfer_decision",
        assistant_text="Approved.",
        recipient_id="ali",
        amount=15.0,
        decision="APPROVED",
    )
    _response_from_agent_decision(
        agent=MainAgentRuntime(agent=None),
        agent_decision=decision,
        steps=[],
        source_text="send rm15 to ali",
        thread_id="thread-2",
        user_id="user-42",
    )

    assert captured["user_id"] == "user-42"


def test_neptune_contact_search_queries_name_and_id(monkeypatch) -> None:
    class StubSettings:
        use_mock_graph = False
        neptune_endpoint = "dummy.neptune.amazonaws.com"
        aws_profile = ""
        aws_region = "ap-southeast-1"

    captured_query: dict[str, str] = {}

    class FakeClient:
        def execute_open_cypher_query(self, openCypherQuery, parameters):
            captured_query["query"] = openCypherQuery
            captured_query["parameters"] = parameters
            return {"results": [{"graph_id": "user:ali", "display_name": "Ali Bin Abu"}]}

    class FakeSession:
        def __init__(self, *args, **kwargs):
            pass

        def client(self, *args, **kwargs):
            return FakeClient()

    monkeypatch.setattr("transaction_agent.graph_tools.Settings", StubSettings)
    monkeypatch.setattr("transaction_agent.graph_tools.boto3.Session", FakeSession)

    result = search_contact_nodes_tool("ali", limit=3)

    assert "coalesce(u.name, '')" in captured_query["query"]
    assert "u.`~id`" in captured_query["query"]
    assert json.loads(captured_query["parameters"]) == {"q": "ali", "limit": 3}
    assert result["contacts"][0]["display_name"] == "Ali Bin Abu"
