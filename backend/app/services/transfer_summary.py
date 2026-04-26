import json
import time
from typing import Any

from botocore.config import Config

from app.core.config import Settings
from app.services.aws_session import build_boto3_session


SUMMARY_AGENT_VERSION = "main_agent_transfer_summary_v1"


def update_transfer_participant_summaries(transaction_id: str) -> dict[str, Any]:
    """Update sender and recipient User summaries from a settled transfer edge."""
    settings = Settings()
    tx_id = transaction_id.strip()
    if not tx_id:
        return {"transaction_id": transaction_id, "updated": False, "reason": "missing_transaction_id"}
    if not settings.neptune_endpoint:
        return {"transaction_id": tx_id, "updated": False, "reason": "neptune_not_configured"}

    try:
        client = _neptune_data_client(settings)
        lookup = client.execute_open_cypher_query(
            openCypherQuery=(
                "MATCH (s:User)-[t:TRANSFERRED_TO]->(r:User) "
                "WHERE t.`~id` = $transaction_id "
                "RETURN "
                "s.`~id` AS sender_graph_id, "
                "r.`~id` AS recipient_graph_id, "
                "coalesce(s.name, s.user_id, s.`~id`) AS sender_name, "
                "coalesce(r.name, r.user_id, r.`~id`) AS recipient_name, "
                "s.summary_text_latest AS sender_summary, "
                "r.summary_text_latest AS recipient_summary, "
                "coalesce(t.amount, 0) AS amount, "
                "coalesce(t.currency, 'MYR') AS currency, "
                "coalesce(t.message_text, t.tx_note, 'Transfer') AS purpose, "
                "coalesce(t.risk_decision_latest, 'APPROVED') AS decision, "
                "coalesce(t.risk_score_latest, 0) AS risk_score, "
                "coalesce(t.wallet_settled, false) AS wallet_settled, "
                "coalesce(t.summary_updates_applied, false) AS summary_updates_applied "
                "LIMIT 1"
            ),
            parameters=json.dumps({"transaction_id": tx_id}),
        )
        rows = lookup.get("results", [])
        if not rows:
            return {"transaction_id": tx_id, "updated": False, "reason": "transfer_not_found"}

        row = rows[0]
        if row.get("summary_updates_applied"):
            return {"transaction_id": tx_id, "updated": False, "reason": "already_applied"}
        if not row.get("wallet_settled"):
            return {"transaction_id": tx_id, "updated": False, "reason": "transfer_not_settled"}

        sender_summary = _next_transfer_summary(
            previous=row.get("sender_summary"),
            event_text=_format_transfer_summary_event(
                direction="outgoing",
                counterparty=str(row.get("recipient_name") or "recipient"),
                amount=float(row.get("amount", 0) or 0),
                currency=str(row.get("currency", "MYR") or "MYR"),
                purpose=str(row.get("purpose", "Transfer") or "Transfer"),
                decision=str(row.get("decision", "APPROVED") or "APPROVED"),
                risk_score=int(float(row.get("risk_score", 0) or 0)),
            ),
        )
        recipient_summary = _next_transfer_summary(
            previous=row.get("recipient_summary"),
            event_text=_format_transfer_summary_event(
                direction="incoming",
                counterparty=str(row.get("sender_name") or "sender"),
                amount=float(row.get("amount", 0) or 0),
                currency=str(row.get("currency", "MYR") or "MYR"),
                purpose=str(row.get("purpose", "Transfer") or "Transfer"),
                decision=str(row.get("decision", "APPROVED") or "APPROVED"),
                risk_score=int(float(row.get("risk_score", 0) or 0)),
            ),
        )
        updated_at = int(time.time())
        update = client.execute_open_cypher_query(
            openCypherQuery=(
                "MATCH (s:User)-[t:TRANSFERRED_TO]->(r:User) "
                "WHERE t.`~id` = $transaction_id "
                "AND coalesce(t.summary_updates_applied, false) = false "
                "SET "
                "s.summary_text_latest = $sender_summary, "
                "s.summary_updated_at = $updated_at, "
                "s.summary_agent_version = $agent_version, "
                "r.summary_text_latest = $recipient_summary, "
                "r.summary_updated_at = $updated_at, "
                "r.summary_agent_version = $agent_version, "
                "t.summary_updates_applied = true, "
                "t.summary_updated_at = $updated_at "
                "RETURN s.`~id` AS sender_graph_id, r.`~id` AS recipient_graph_id"
            ),
            parameters=json.dumps(
                {
                    "transaction_id": tx_id,
                    "sender_summary": sender_summary,
                    "recipient_summary": recipient_summary,
                    "updated_at": updated_at,
                    "agent_version": SUMMARY_AGENT_VERSION,
                }
            ),
        )
        updated_rows = update.get("results", [])
        if not updated_rows:
            return {"transaction_id": tx_id, "updated": False, "reason": "already_applied"}
        return {
            "transaction_id": tx_id,
            "updated": True,
            "sender_graph_id": updated_rows[0].get("sender_graph_id"),
            "recipient_graph_id": updated_rows[0].get("recipient_graph_id"),
        }
    except Exception as exc:  # noqa: BLE001
        return {"transaction_id": tx_id, "updated": False, "error": f"summary_update_failed: {exc}"}


def _neptune_data_client(settings: Settings):
    session = build_boto3_session(
        region=settings.aws_region,
        profile=settings.aws_profile or None,
    )

    return session.client(
        "neptunedata",
        endpoint_url=f"https://{settings.neptune_endpoint}:8182",
        config=Config(connect_timeout=1, read_timeout=2, retries={"max_attempts": 1, "mode": "standard"}),
    )


def _format_transfer_summary_event(
    *,
    direction: str,
    counterparty: str,
    amount: float,
    currency: str,
    purpose: str,
    decision: str,
    risk_score: int,
) -> str:
    verb = "Sent" if direction == "outgoing" else "Received"
    preposition = "to" if direction == "outgoing" else "from"
    clean_purpose = " ".join(purpose.split()).strip() or "Transfer"
    clean_counterparty = " ".join(counterparty.split()).strip() or "unknown"
    return (
        f"Latest {direction} transfer: {verb} {currency} {amount:,.2f} "
        f"{preposition} {clean_counterparty} for {clean_purpose}. "
        f"Decision: {decision}; risk score: {risk_score}."
    )


def _next_transfer_summary(previous: Any, event_text: str, max_chars: int = 900) -> str:
    previous_text = str(previous or "").strip()
    if not previous_text:
        return event_text
    if event_text in previous_text:
        return previous_text
    combined = f"{previous_text}\n{event_text}"
    if len(combined) <= max_chars:
        return combined
    return combined[-max_chars:].lstrip()
