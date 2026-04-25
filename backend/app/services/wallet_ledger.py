import json
import logging
import os
import time
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import Settings
from app.services.aws_session import build_boto3_session

_log = logging.getLogger(__name__)


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
        self._table_name = os.getenv("DYNAMO_TABLE", "tng_guardian_users")
        self._dynamo_table = self._build_dynamo_table()
        self._dynamo_client = self._dynamo_table.meta.client
        self._neptune_client = self._build_neptune_client()

    def _build_dynamo_table(self):
        session = build_boto3_session(
            region=self._settings.aws_region,
            profile=self._settings.aws_profile or None,
        )
        resource = session.resource("dynamodb")
        return resource.Table(self._table_name)

    def _build_neptune_client(self):
        if not self._settings.neptune_endpoint:
            return None
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

    def _resolve_user_or_raise(self, raw_user_id: str) -> tuple[str, dict]:
        for candidate in self._candidate_user_ids(raw_user_id):
            response = self._dynamo_table.get_item(Key={"user_id": candidate})
            item = response.get("Item")
            if item:
                return candidate, item
        raise UserNotFoundError(raw_user_id)

    def settle_transfer(self, sender_user_id: str, recipient_user_id: str, amount: float) -> WalletSettlementResult:
        if sender_user_id == recipient_user_id:
            raise WalletSettlementError("sender_and_recipient_must_differ")

        transfer_amount = _to_amount(amount)
        sender_resolved_id, sender_item = self._resolve_user_or_raise(sender_user_id)
        recipient_resolved_id, recipient_item = self._resolve_user_or_raise(recipient_user_id)

        sender_balance = _to_amount(float(sender_item.get("balance", 0)))
        recipient_balance = _to_amount(float(recipient_item.get("balance", 0)))
        if sender_balance < transfer_amount:
            raise InsufficientBalanceError(
                user_id=sender_user_id,
                current_balance=float(sender_balance),
                required_amount=float(transfer_amount),
            )

        updated_at = str(int(time.time()))
        amount_str = str(transfer_amount)
        sender_balance_after = sender_balance - transfer_amount
        recipient_balance_after = recipient_balance + transfer_amount

        try:
            self._dynamo_client.transact_write_items(
                TransactItems=[
                    {
                        "Update": {
                            "TableName": self._table_name,
                            "Key": {"user_id": {"S": sender_resolved_id}},
                            "UpdateExpression": "SET balance = balance - :amt, updated_at = :ts",
                            "ConditionExpression": "attribute_exists(user_id) AND balance >= :amt",
                            "ExpressionAttributeValues": {
                                ":amt": {"N": amount_str},
                                ":ts": {"S": updated_at},
                            },
                        }
                    },
                    {
                        "Update": {
                            "TableName": self._table_name,
                            "Key": {"user_id": {"S": recipient_resolved_id}},
                            "UpdateExpression": "SET balance = balance + :amt, updated_at = :ts",
                            "ConditionExpression": "attribute_exists(user_id)",
                            "ExpressionAttributeValues": {
                                ":amt": {"N": amount_str},
                                ":ts": {"S": updated_at},
                            },
                        }
                    },
                ]
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code == "TransactionCanceledException":
                # Re-check sender to provide a deterministic API error.
                _, latest_sender = self._resolve_user_or_raise(sender_user_id)
                latest_sender_balance = _to_amount(float(latest_sender.get("balance", 0)))
                if latest_sender_balance < transfer_amount:
                    raise InsufficientBalanceError(
                        user_id=sender_user_id,
                        current_balance=float(latest_sender_balance),
                        required_amount=float(transfer_amount),
                    ) from exc
                raise WalletSettlementError("wallet_transaction_cancelled") from exc
            raise WalletSettlementError(f"wallet_transaction_failed:{code}") from exc

        self._sync_neptune_balance(sender_resolved_id, float(sender_balance_after))
        self._sync_neptune_balance(recipient_resolved_id, float(recipient_balance_after))

        return WalletSettlementResult(
            sender_balance=float(sender_balance_after),
            recipient_balance=float(recipient_balance_after),
        )

    def _sync_neptune_balance(self, user_id: str, balance: float) -> None:
        if self._neptune_client is None:
            return

        query = (
            "MATCH (u:User) "
            "WHERE u.user_id = $uid OR u.`~id` = $graph_id "
            "SET u.balance = $balance, u.updated_at = $updated_at "
            "RETURN count(u) AS updated_count"
        )
        params = {
            "uid": user_id,
            "graph_id": user_id if user_id.startswith("user:") else f"user:{user_id}",
            "balance": float(balance),
            "updated_at": int(time.time()),
        }
        try:
            self._neptune_client.execute_open_cypher_query(
                openCypherQuery=query,
                parameters=json.dumps(params),
            )
        except Exception as exc:  # noqa: BLE001
            _log.error("Neptune balance sync failed for %s: %s", user_id, exc)
