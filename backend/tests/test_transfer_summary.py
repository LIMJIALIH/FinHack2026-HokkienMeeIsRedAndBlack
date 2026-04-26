import json

from app.services import transfer_summary


class StubSettings:
    neptune_endpoint = "example.neptune"
    aws_region = "ap-southeast-1"
    aws_profile = None


class FakeNeptuneClient:
    def __init__(self) -> None:
        self.summary_updates_applied = False
        self.update_calls = 0
        self.sender_summary = "Sender profile"
        self.recipient_summary = ""

    def execute_open_cypher_query(self, openCypherQuery, parameters=None):
        params = json.loads(parameters or "{}")

        if "summary_updates_applied AS summary_updates_applied" in openCypherQuery:
            return {
                "results": [
                    {
                        "sender_graph_id": "user:alice",
                        "recipient_graph_id": "user:bob",
                        "sender_name": "Alice",
                        "recipient_name": "Bob",
                        "sender_summary": self.sender_summary,
                        "recipient_summary": self.recipient_summary,
                        "amount": 10.0,
                        "currency": "MYR",
                        "purpose": "dinner",
                        "decision": "APPROVED",
                        "risk_score": 10,
                        "wallet_settled": True,
                        "summary_updates_applied": self.summary_updates_applied,
                    }
                ]
            }

        if "SET s.summary_text_latest" in openCypherQuery:
            if self.summary_updates_applied:
                return {"results": []}
            self.update_calls += 1
            self.summary_updates_applied = True
            self.sender_summary = params["sender_summary"]
            self.recipient_summary = params["recipient_summary"]
            return {
                "results": [
                    {
                        "sender_graph_id": "user:alice",
                        "recipient_graph_id": "user:bob",
                    }
                ]
            }

        raise AssertionError(f"Unexpected query: {openCypherQuery}")


def test_update_transfer_participant_summaries_updates_both_users_once(monkeypatch) -> None:
    client = FakeNeptuneClient()
    monkeypatch.setattr(transfer_summary, "Settings", StubSettings)
    monkeypatch.setattr(transfer_summary, "_neptune_data_client", lambda settings: client)

    first = transfer_summary.update_transfer_participant_summaries("tx_test")
    second = transfer_summary.update_transfer_participant_summaries("tx_test")

    assert first["updated"] is True
    assert second == {
        "transaction_id": "tx_test",
        "updated": False,
        "reason": "already_applied",
    }
    assert "Latest outgoing transfer: Sent MYR 10.00 to Bob for dinner." in client.sender_summary
    assert "Latest incoming transfer: Received MYR 10.00 from Alice for dinner." in client.recipient_summary
    assert client.update_calls == 1
