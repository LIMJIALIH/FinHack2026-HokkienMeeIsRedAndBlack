import json

from app.services.wallet_ledger import WalletLedger


class FakeNeptuneClient:
    def __init__(self) -> None:
        self.users = {
            "sender-node": {
                "graph_id": "sender-node",
                "user_id": "user:alice",
                "name": "Alice",
                "balance": 100.0,
            },
            "user:bob": {
                "graph_id": "user:bob",
                "user_id": None,
                "name": "Bob",
                "balance": 0.0,
            },
        }
        self.settled_transfer_ids: set[str] = set()
        self.update_calls = 0

    def execute_open_cypher_query(self, openCypherQuery, parameters):
        params = json.loads(parameters or "{}")

        if "RETURN u.`~id` AS graph_id" in openCypherQuery:
            candidates = set(params["candidates"])
            for user in self.users.values():
                if user["graph_id"] in candidates or user.get("user_id") in candidates:
                    return {"results": [user.copy()]}
            return {"results": []}

        if "wallet_settled" in openCypherQuery and "RETURN coalesce" in openCypherQuery:
            return {
                "results": [
                    {"wallet_settled": params["transaction_id"] in self.settled_transfer_ids}
                ]
            }

        if "SET s.balance" in openCypherQuery:
            self.update_calls += 1
            sender = self.users[params["sender_graph_id"]]
            recipient = self.users[params["recipient_graph_id"]]
            sender["balance"] = params["sender_balance_after"]
            recipient["balance"] = params["recipient_balance_after"]
            if params["transaction_id"]:
                self.settled_transfer_ids.add(params["transaction_id"])
            return {
                "results": [
                    {
                        "sender_balance": sender["balance"],
                        "recipient_balance": recipient["balance"],
                    }
                ]
            }

        raise AssertionError(f"Unexpected query: {openCypherQuery}")


def test_wallet_ledger_repeated_transaction_id_is_idempotent() -> None:
    client = FakeNeptuneClient()
    ledger = WalletLedger.__new__(WalletLedger)
    ledger._neptune_client = client

    first = ledger.settle_transfer("user:alice", "user:bob", 10.0, transaction_id="tx_same")
    second = ledger.settle_transfer("user:alice", "user:bob", 10.0, transaction_id="tx_same")

    assert first.sender_balance == 90.0
    assert first.recipient_balance == 10.0
    assert second.sender_balance == 90.0
    assert second.recipient_balance == 10.0
    assert client.users["sender-node"]["balance"] == 90.0
    assert client.users["user:bob"]["balance"] == 10.0
    assert client.update_calls == 1
