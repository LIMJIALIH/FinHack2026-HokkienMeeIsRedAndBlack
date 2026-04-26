"""Tests for the refactored interrupt_on–based transaction agent.

These tests validate the new HITL architecture where ``execute_transfer``
is gated by LangGraph's ``interrupt_on`` middleware.
"""

import json

from transaction_agent.agent import (
    _build_review_card,
    _extract_tool_args_from_interrupt,
    execute_transfer,
)
from transaction_agent.graph_tools import search_contact_nodes_tool


def test_build_review_card_low_risk() -> None:
    """A low risk_score produces an APPROVED decision preview."""
    tool_args = {
        "sender_user_id": "marcus",
        "recipient_id": "ali",
        "amount": 15.0,
        "currency": "MYR",
        "message": "lunch money",
        "risk_score": 10,
        "reason_codes": [],
        "evidence_refs": ["user:ali", "tx:sample_ali_001"],
        "assistant_text": "Transfer looks safe.",
    }
    card = _build_review_card(tool_args)

    assert card["card_type"] == "transfer_review"
    assert card["decision_preview"] == "APPROVED"
    assert card["risk_score"] == 10
    assert "15.00" in card["subtitle"]
    assert "ali" in card["subtitle"]


def test_build_review_card_medium_risk() -> None:
    """Presence of reason_codes bumps preview to WARNING."""
    tool_args = {
        "recipient_id": "siti",
        "amount": 200.0,
        "currency": "MYR",
        "risk_score": 35,
        "reason_codes": ["unusual_amount"],
        "evidence_refs": [],
    }
    card = _build_review_card(tool_args)
    assert card["decision_preview"] == "WARNING"


def test_build_review_card_high_risk() -> None:
    """High risk_score produces INTERVENTION_REQUIRED."""
    tool_args = {
        "recipient_id": "investment_agent",
        "amount": 1000.0,
        "currency": "MYR",
        "risk_score": 82,
        "reason_codes": ["high_risk_summary", "warned_history"],
        "evidence_refs": [],
    }
    card = _build_review_card(tool_args)
    assert card["decision_preview"] == "INTERVENTION_REQUIRED"


def test_extract_tool_args_from_hitl_request() -> None:
    """Extracts args from the standard HITLRequest interrupt format."""
    interrupt_value = {
        "action_requests": [
            {
                "name": "execute_transfer",
                "args": {
                    "sender_user_id": "marcus",
                    "recipient_id": "ali",
                    "amount": 5.0,
                },
                "description": "Tool execution requires approval",
            }
        ],
        "review_configs": [
            {"action_name": "execute_transfer", "allowed_decisions": ["approve", "reject"]}
        ],
    }
    result = _extract_tool_args_from_interrupt(interrupt_value, messages=[])
    assert result is not None
    assert result["recipient_id"] == "ali"
    assert result["amount"] == 5.0


def test_extract_tool_args_returns_none_for_unrelated_interrupt() -> None:
    """Returns None when no execute_transfer is found."""
    interrupt_value = {
        "action_requests": [
            {"name": "some_other_tool", "args": {}, "description": "test"}
        ],
    }
    result = _extract_tool_args_from_interrupt(interrupt_value, messages=[])
    assert result is None


def test_execute_transfer_uses_single_confirmed_settlement(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_submit_llm_transfer_decision_tool(**kwargs):
        captured.update(kwargs)
        return {
            "transaction_id": "tx_test",
            "decision": "APPROVED",
            "risk_score": kwargs["risk_score"],
            "reason_codes": kwargs["reason_codes"],
            "evidence_refs": kwargs["evidence_refs"],
            "latency_ms": 0,
            "warning_id": None,
            "warning_delay_seconds": 0,
            "sender_balance": 97.12,
            "recipient_balance": 2.88,
        }

    monkeypatch.setattr(
        "transaction_agent.agent.submit_llm_transfer_decision_tool",
        fake_submit_llm_transfer_decision_tool,
    )

    result = json.loads(
        execute_transfer(
            sender_user_id="user:alice",
            recipient_id="user:bob",
            amount=2.88,
            message="coffee",
            risk_score=5,
        )
    )

    assert captured["hitl_already_confirmed"] is True
    assert result["warning_id"] is None
    assert result["backend_status"] == "APPROVED"


def test_neptune_contact_search_queries_name_and_id(monkeypatch) -> None:
    class StubSettings:
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
        def client(self, *args, **kwargs):
            return FakeClient()

    monkeypatch.setattr("transaction_agent.graph_tools.Settings", StubSettings)
    monkeypatch.setattr("transaction_agent.graph_tools.build_boto3_session", lambda **kwargs: FakeSession())

    result = search_contact_nodes_tool("ali", limit=3)

    assert "coalesce(u.name, '')" in captured_query["query"]
    assert "u.`~id`" in captured_query["query"]
    assert json.loads(captured_query["parameters"]) == {"q": "ali", "limit": 3}
    assert result["contacts"][0]["display_name"] == "Ali Bin Abu"
