import json
import time
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from botocore.config import Config

from app.core.config import Settings
from app.services.aws_session import build_boto3_session


class WalletSettlementError(RuntimeError):
    pass


class UserNotFoundError(WalletSettlementError):
    def __init__(self, user_id: str) -> None:
        super().__init__(f"user_not_found:{user_id}")
        self.user_id = user_id


class InsufficientBalanceError(WalletSettlementError):
    def __init__(self, user_id: str, current_balance: float, required_amount: float) -> None:
        super().__init__(
            f"insufficient_balance:{user_id}:current={current_balance:.2f}:required={required_amount:.2f}"
        )
        self.user_id = user_id
        self.current_balance = current_balance
        self.required_amount = required_amount


@dataclass
class WalletSettlementResult:
    sender_balance: float
    recipient_balance: float


def _to_amount(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class WalletLedger:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or Settings()
        self._neptune_client = self._build_neptune_client()

    def _build_neptune_client(self):
        if not self._settings.neptune_endpoint:
            raise WalletSettlementError("neptune_not_configured")
        session = build_boto3_session(
            region=self._settings.aws_region,
            profile=self._settings.aws_profile or None,
        )

        return session.client(
            "neptunedata",
            endpoint_url=f"https://{self._settings.neptune_endpoint}:8182",
            config=Config(connect_timeout=1, read_timeout=1, retries={"max_attempts": 1, "mode": "standard"}),
        )

    @staticmethod
    def _candidate_user_ids(raw_user_id: str) -> list[str]:
        candidates: list[str] = []
        if raw_user_id:
            candidates.append(raw_user_id)
            if raw_user_id.startswith("user:"):
                stripped = raw_user_id[5:]
                if stripped:
                    candidates.append(stripped)
            else:
                candidates.append(f"user:{raw_user_id}")
        # Preserve order while de-duplicating.
        deduped: list[str] = []
        for value in candidates:
            if value not in deduped:
                deduped.append(value)
        return deduped

    def _resolve_user_or_raise(self, raw_user_id: str) -> dict:
        candidates = self._candidate_user_ids(raw_user_id)
        response = self._neptune_client.execute_open_cypher_query(
            openCypherQuery=(
                "MATCH (u:User) "
                "WHERE u.`~id` IN $candidates OR u.user_id IN $candidates "
                "RETURN u.`~id` AS graph_id, u.user_id AS user_id, "
                "u.name AS name, coalesce(u.balance, 0) AS balance "
                "ORDER BY "
                "CASE WHEN u.balance IS NULL THEN 1 ELSE 0 END, "
                "CASE WHEN u.user_id = $raw_user_id THEN 0 ELSE 1 END "
                "LIMIT 1"
            ),
            parameters=json.dumps({"candidates": candidates, "raw_user_id": raw_user_id}),
        )
        rows = response.get("results", [])
        if rows:
            return rows[0]
        raise UserNotFoundError(raw_user_id)

    def _transfer_already_settled(self, transaction_id: str) -> bool:
        if not transaction_id:
            return False
        response = self._neptune_client.execute_open_cypher_query(
            openCypherQuery=(
                "MATCH ()-[t:TRANSFERRED_TO {`~id`: $transaction_id}]->() "
                "RETURN coalesce(t.wallet_settled, false) AS wallet_settled "
                "LIMIT 1"
            ),
            parameters=json.dumps({"transaction_id": transaction_id}),
        )
        rows = response.get("results", [])
        return bool(rows and rows[0].get("wallet_settled"))

    def settle_transfer(
        self,
        sender_user_id: str,
        recipient_user_id: str,
        amount: float,
        transaction_id: str | None = None,
    ) -> WalletSettlementResult:
        if sender_user_id == recipient_user_id:
            raise WalletSettlementError("sender_and_recipient_must_differ")

        tx_id = (transaction_id or "").strip()
        transfer_amount = _to_amount(amount)
        sender_item = self._resolve_user_or_raise(sender_user_id)
        recipient_item = self._resolve_user_or_raise(recipient_user_id)

        if tx_id and self._transfer_already_settled(tx_id):
            return WalletSettlementResult(
                sender_balance=float(_to_amount(float(sender_item.get("balance", 0)))),
                recipient_balance=float(_to_amount(float(recipient_item.get("balance", 0)))),
            )

        sender_balance = _to_amount(float(sender_item.get("balance", 0)))
        recipient_balance = _to_amount(float(recipient_item.get("balance", 0)))
        if sender_balance < transfer_amount:
            raise InsufficientBalanceError(
                user_id=sender_user_id,
                current_balance=float(sender_balance),
                required_amount=float(transfer_amount),
            )

        updated_at = int(time.time())
        sender_balance_after = sender_balance - transfer_amount
        recipient_balance_after = recipient_balance + transfer_amount

        try:
            self._neptune_client.execute_open_cypher_query(
                openCypherQuery=(
                    "MATCH (s:User {`~id`: $sender_graph_id}) "
                    "MATCH (r:User {`~id`: $recipient_graph_id}) "
                    "SET s.balance = $sender_balance_after, "
                    "s.updated_at = $updated_at, "
                    "r.balance = $recipient_balance_after, "
                    "r.updated_at = $updated_at "
                    "WITH s, r "
                    "OPTIONAL MATCH ()-[t:TRANSFERRED_TO {`~id`: $transaction_id}]->() "
                    "SET t.wallet_settled = CASE WHEN $transaction_id = '' THEN t.wallet_settled ELSE true END, "
                    "t.sender_balance_after = CASE WHEN $transaction_id = '' THEN t.sender_balance_after ELSE $sender_balance_after END, "
                    "t.recipient_balance_after = CASE WHEN $transaction_id = '' THEN t.recipient_balance_after ELSE $recipient_balance_after END "
                    "RETURN s.balance AS sender_balance, r.balance AS recipient_balance"
                ),
                parameters=json.dumps(
                    {
                        "sender_graph_id": sender_item["graph_id"],
                        "recipient_graph_id": recipient_item["graph_id"],
                        "transaction_id": tx_id,
                        "sender_balance_after": float(sender_balance_after),
                        "recipient_balance_after": float(recipient_balance_after),
                        "updated_at": updated_at,
                    }
                ),
            )
        except Exception as exc:  # noqa: BLE001
            raise WalletSettlementError(f"neptune_wallet_update_failed:{exc}") from exc

        return WalletSettlementResult(
            sender_balance=float(sender_balance_after),
            recipient_balance=float(recipient_balance_after),
        )
