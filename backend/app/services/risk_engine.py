import json
import time
import uuid
from datetime import datetime, timezone
from typing import NotRequired, TypedDict

import boto3
from botocore.config import Config
from botocore.exceptions import ProfileNotFound
from langgraph.graph import END, START, StateGraph

from app.schemas.transfer import (
    RiskCheckResult,
    RiskGraphEdge,
    RiskGraphNode,
    RiskGraphResponse,
    RiskGraphStats,
    TransferEvaluateRequest,
)


class FlowState(TypedDict):
    request: TransferEvaluateRequest
    risk: NotRequired[RiskCheckResult]


class GraphStats(TypedDict):
    tx_count: int
    max_risk_score: int
    flagged_tx_count: int
    source: str


def _graph_risk_from_stats(tx_count: int, max_risk_score: int, flagged_tx_count: int) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    if tx_count == 0:
        score += 15
        reasons.append("GRAPH_NO_PRIOR_TRANSFER")
    if tx_count > 20:
        score += 10
        reasons.append("GRAPH_HIGH_REPEAT_TRANSFER_PATTERN")
    if flagged_tx_count >= 3:
        score += 15
        reasons.append("GRAPH_RECIPIENT_FLAGGED_HISTORY")
    if max_risk_score >= 70:
        score += 20
        reasons.append("GRAPH_HIGH_RISK_HISTORY")
    return score, reasons


def _to_graph_user_id(user_id: str) -> str:
    return user_id if user_id.startswith("user:") else f"user:{user_id}"


def _extract_graph_metric(evidence: list[str], key: str) -> int:
    prefix = f"graph:{key}="
    for item in evidence:
        if item.startswith(prefix):
            value = item[len(prefix) :]
            try:
                return int(value)
            except ValueError:
                return 0
    return 0


def _extract_graph_source(evidence: list[str]) -> str:
    prefix = "graph:source="
    for item in evidence:
        if item.startswith(prefix):
            return item[len(prefix) :]
    return "unknown"


def _display_name(graph_id: str) -> str:
    raw = graph_id.split(":", 1)[1] if graph_id.startswith("user:") else graph_id
    parts = [part for part in raw.replace("-", "_").split("_") if part]
    if not parts:
        return "Unknown"
    return " ".join(part.capitalize() for part in parts)


class NeptuneRiskClient:
    def __init__(self, endpoint: str, region: str, profile: str | None) -> None:
        try:
            session = boto3.Session(profile_name=profile or None, region_name=region)
        except ProfileNotFound:
            session = boto3.Session(region_name=region)
        self._client = session.client(
            "neptunedata",
            endpoint_url=f"https://{endpoint}:8182",
            config=Config(connect_timeout=1, read_timeout=1, retries={"max_attempts": 1, "mode": "standard"}),
        )

    def fetch_graph_risk(self, user_id: str, recipient_id: str) -> tuple[int, list[str], list[str], int]:
        sender_graph_id = _to_graph_user_id(user_id)
        recipient_graph_id = _to_graph_user_id(recipient_id)
        query = (
            "MATCH (u:User {`~id`: $sender_id})-[t:TRANSFERRED_TO]->(r:User {`~id`: $recipient_id}) "
            "RETURN "
            "count(t) AS tx_count, "
            "max(coalesce(t.risk_score_latest, 0)) AS max_risk_score, "
            "sum(CASE WHEN t.status IN ['warned', 'blocked', 'reversed'] THEN 1 ELSE 0 END) AS flagged_tx_count"
        )
        params = json.dumps({"sender_id": sender_graph_id, "recipient_id": recipient_graph_id})
        start = time.perf_counter()
        response = self._client.execute_open_cypher_query(openCypherQuery=query, parameters=params)
        latency_ms = int((time.perf_counter() - start) * 1000)
        rows = response.get("results", [])
        tx_count = int(rows[0].get("tx_count", 0)) if rows else 0
        max_risk_score = int(float(rows[0].get("max_risk_score", 0))) if rows else 0
        flagged_tx_count = int(rows[0].get("flagged_tx_count", 0)) if rows else 0

        score, reasons = _graph_risk_from_stats(
            tx_count=tx_count,
            max_risk_score=max_risk_score,
            flagged_tx_count=flagged_tx_count,
        )
        evidence = [
            "graph:source=neptune",
            f"graph:tx_count={tx_count}",
            f"graph:max_risk_score={max_risk_score}",
            f"graph:flagged_tx_count={flagged_tx_count}",
        ]
        return score, reasons, evidence, latency_ms

    def upsert_transfer(
        self,
        sender_user_id: str,
        recipient_user_id: str,
        transaction_id: str,
        tx_time: str,
        amount: float,
        currency: str,
        message_text: str,
        tx_note: str | None,
        channel: str,
        status: str,
        finbert_score: int,
        emotion_score: int,
        risk_score_latest: int,
        risk_reason_codes: list[str],
        risk_decision: str,
        requires_hitl: bool,
        updated_at_epoch: int,
    ) -> None:
        query = (
            "MERGE (u:User {`~id`: $sender_id}) "
            "ON CREATE SET u.created_at = $updated_at_epoch "
            "SET u.updated_at = $updated_at_epoch "
            "MERGE (r:User {`~id`: $recipient_id}) "
            "ON CREATE SET r.created_at = $updated_at_epoch "
            "SET r.updated_at = $updated_at_epoch "
            "MERGE (u)-[t:TRANSFERRED_TO {`~id`: $tx_id}]->(r) "
            "ON CREATE SET "
            "t.tx_time = $tx_time, "
            "t.amount = $amount, "
            "t.currency = $currency, "
            "t.message_text = $message_text, "
            "t.tx_note = $tx_note, "
            "t.channel = $channel "
            "SET "
            "t.status = $status, "
            "t.finbert_score = $finbert_score, "
            "t.emotion_score = $emotion_score, "
            "t.risk_score_latest = $risk_score_latest, "
            "t.risk_reason_codes = $risk_reason_codes, "
            "t.risk_decision_latest = $risk_decision, "
            "t.requires_hitl = $requires_hitl, "
            "t.updated_at = $updated_at_epoch"
        )
        params = {
            "sender_id": _to_graph_user_id(sender_user_id),
            "recipient_id": _to_graph_user_id(recipient_user_id),
            "tx_id": transaction_id,
            "tx_time": tx_time,
            "amount": amount,
            "currency": currency,
            "message_text": message_text,
            "tx_note": tx_note,
            "channel": channel,
            "status": status,
            "finbert_score": finbert_score,
            "emotion_score": emotion_score,
            "risk_score_latest": risk_score_latest,
            # Neptune property values are scalar for this path; store reason codes as JSON string.
            "risk_reason_codes": json.dumps(sorted(set(risk_reason_codes))),
            "risk_decision": risk_decision,
            "requires_hitl": requires_hitl,
            "updated_at_epoch": updated_at_epoch,
        }
        self._client.execute_open_cypher_query(openCypherQuery=query, parameters=json.dumps(params))

    def update_transfer_status(self, transaction_id: str, status: str, updated_at_epoch: int) -> bool:
        query = (
            "MATCH ()-[t:TRANSFERRED_TO {`~id`: $tx_id}]->() "
            "SET t.status = $status, t.updated_at = $updated_at_epoch "
            "RETURN t.`~id` AS tx_id "
            "LIMIT 1"
        )
        params = {"tx_id": transaction_id, "status": status, "updated_at_epoch": updated_at_epoch}
        response = self._client.execute_open_cypher_query(openCypherQuery=query, parameters=json.dumps(params))
        return bool(response.get("results", []))

class MockGraphRiskClient:
    def __init__(self, assumed_user_id: str = "marcus") -> None:
        sender = _to_graph_user_id(assumed_user_id)
        self._stats_by_pair: dict[tuple[str, str], dict[str, int]] = {
            (sender, "user:investment_agent"): {"tx_count": 24, "max_risk_score": 82, "flagged_tx_count": 5},
            (sender, "user:ali"): {"tx_count": 8, "max_risk_score": 18, "flagged_tx_count": 0},
        }
        self._transfer_index: dict[str, tuple[str, str, str]] = {}

    def fetch_graph_risk(self, user_id: str, recipient_id: str) -> tuple[int, list[str], list[str], int]:
        sender_graph_id = _to_graph_user_id(user_id)
        recipient_graph_id = _to_graph_user_id(recipient_id)
        stats = self._stats_by_pair.get((sender_graph_id, recipient_graph_id))
        if stats is None:
            stats = {"tx_count": 0, "max_risk_score": 0, "flagged_tx_count": 0}
        tx_count = int(stats.get("tx_count", 0))
        max_risk_score = int(stats.get("max_risk_score", 0))
        flagged_tx_count = int(stats.get("flagged_tx_count", 0))
        score, reasons = _graph_risk_from_stats(
            tx_count=tx_count,
            max_risk_score=max_risk_score,
            flagged_tx_count=flagged_tx_count,
        )
        evidence = [
            "graph:source=mock",
            f"graph:tx_count={tx_count}",
            f"graph:max_risk_score={max_risk_score}",
            f"graph:flagged_tx_count={flagged_tx_count}",
        ]
        return score, reasons, evidence, 3

    def upsert_transfer(
        self,
        sender_user_id: str,
        recipient_user_id: str,
        transaction_id: str,
        tx_time: str,
        amount: float,
        currency: str,
        message_text: str,
        tx_note: str | None,
        channel: str,
        status: str,
        finbert_score: int,
        emotion_score: int,
        risk_score_latest: int,
        risk_reason_codes: list[str],
        risk_decision: str,
        requires_hitl: bool,
        updated_at_epoch: int,
    ) -> None:
        del tx_time, amount, currency, message_text, tx_note, channel, finbert_score, emotion_score, risk_reason_codes, risk_decision, requires_hitl, updated_at_epoch
        sender_graph_id = _to_graph_user_id(sender_user_id)
        recipient_graph_id = _to_graph_user_id(recipient_user_id)
        key = (sender_graph_id, recipient_graph_id)
        stats = self._stats_by_pair.setdefault(key, {"tx_count": 0, "max_risk_score": 0, "flagged_tx_count": 0})
        stats["tx_count"] += 1
        stats["max_risk_score"] = max(int(stats["max_risk_score"]), int(risk_score_latest))
        if status in {"warned", "blocked", "reversed"}:
            stats["flagged_tx_count"] += 1
        self._transfer_index[transaction_id] = (sender_graph_id, recipient_graph_id, status)

    def update_transfer_status(self, transaction_id: str, status: str, updated_at_epoch: int) -> bool:
        del updated_at_epoch
        current = self._transfer_index.get(transaction_id)
        if current is None:
            return False
        sender_graph_id, recipient_graph_id, prev_status = current
        key = (sender_graph_id, recipient_graph_id)
        stats = self._stats_by_pair.setdefault(key, {"tx_count": 0, "max_risk_score": 0, "flagged_tx_count": 0})

        prev_flagged = prev_status in {"warned", "blocked", "reversed"}
        new_flagged = status in {"warned", "blocked", "reversed"}
        if prev_flagged and not new_flagged:
            stats["flagged_tx_count"] = max(0, int(stats["flagged_tx_count"]) - 1)
        elif not prev_flagged and new_flagged:
            stats["flagged_tx_count"] += 1
        self._transfer_index[transaction_id] = (sender_graph_id, recipient_graph_id, status)
        return True


class RiskEngine:
    def __init__(self, graph_client: NeptuneRiskClient | MockGraphRiskClient | None) -> None:
        self._graph_client = graph_client

    def evaluate(self, payload: TransferEvaluateRequest) -> RiskCheckResult:
        start = time.perf_counter()
        score = 0
        reasons: list[str] = []
        evidence: list[str] = []

        message_score, message_reasons = self._score_message(payload.message)
        score += message_score
        reasons.extend(message_reasons)

        amount_score, amount_reasons = self._score_amount(payload.amount)
        score += amount_score
        reasons.extend(amount_reasons)

        if payload.recipient_is_new:
            score += 20
            reasons.append("RECIPIENT_NEW")

        graph_latency = 0
        if self._graph_client is not None:
            try:
                graph_score, graph_reasons, graph_evidence, graph_latency = self._graph_client.fetch_graph_risk(
                    payload.user_id,
                    payload.recipient_id,
                )
                score += graph_score
                reasons.extend(graph_reasons)
                evidence.extend(graph_evidence)
            except Exception:
                score += 40
                reasons.append("GRAPH_CHECK_UNAVAILABLE_FAILSAFE_WARNING")
        else:
            score += 40
            reasons.append("GRAPH_CHECK_NOT_CONFIGURED_FAILSAFE_WARNING")

        capped_score, decision = self._decision_for_score(score)

        total_latency_ms = int((time.perf_counter() - start) * 1000)
        evidence.append(f"component:graph_latency_ms={graph_latency}")
        return RiskCheckResult(
            decision=decision,
            risk_score=capped_score,
            reason_codes=sorted(set(reasons)),
            evidence_refs=evidence,
            latency_ms=total_latency_ms,
        )

    def build_risk_graph(self, payload: TransferEvaluateRequest) -> RiskGraphResponse:
        start = time.perf_counter()
        graph_score = 0
        graph_reasons: list[str] = []
        evidence: list[str] = []

        if self._graph_client is not None:
            try:
                graph_score, graph_reasons, evidence, _ = self._graph_client.fetch_graph_risk(
                    payload.user_id,
                    payload.recipient_id,
                )
            except Exception:
                graph_reasons = ["GRAPH_CHECK_UNAVAILABLE_FAILSAFE_WARNING"]
                evidence = [
                    "graph:source=error",
                    "graph:tx_count=0",
                    "graph:max_risk_score=0",
                    "graph:flagged_tx_count=0",
                ]
        else:
            graph_reasons = ["GRAPH_CHECK_NOT_CONFIGURED_FAILSAFE_WARNING"]
            evidence = [
                "graph:source=none",
                "graph:tx_count=0",
                "graph:max_risk_score=0",
                "graph:flagged_tx_count=0",
            ]

        score = 0
        reasons: list[str] = []
        message_score, message_reasons = self._score_message(payload.message)
        score += message_score
        reasons.extend(message_reasons)

        amount_score, amount_reasons = self._score_amount(payload.amount)
        score += amount_score
        reasons.extend(amount_reasons)

        if payload.recipient_is_new:
            score += 20
            reasons.append("RECIPIENT_NEW")

        score += graph_score
        reasons.extend(graph_reasons)

        risk_score, decision = self._decision_for_score(score)
        tx_count = _extract_graph_metric(evidence, "tx_count")
        max_risk_score = _extract_graph_metric(evidence, "max_risk_score")
        flagged_tx_count = _extract_graph_metric(evidence, "flagged_tx_count")
        source = _extract_graph_source(evidence)

        sender_graph_id = _to_graph_user_id(payload.user_id)
        recipient_graph_id = _to_graph_user_id(payload.recipient_id)
        sender_label = _display_name(sender_graph_id)
        recipient_label = _display_name(recipient_graph_id)

        recipient_flagged = flagged_tx_count > 0 or max_risk_score >= 70
        nodes = [
            RiskGraphNode(
                id="user",
                label=sender_label,
                sublabel=f"Sender - {sender_graph_id}",
                x=90,
                y=200,
                kind="user",
                icon="user",
            ),
            RiskGraphNode(
                id="target",
                label=recipient_label,
                sublabel=f"Recipient - {recipient_graph_id}",
                x=360,
                y=90,
                kind="flagged" if recipient_flagged else "neutral",
                icon="wallet",
            ),
            RiskGraphNode(
                id="ip",
                label="Shared IP",
                sublabel="Mock IP relation",
                x=360,
                y=310,
                kind="flagged" if flagged_tx_count > 0 else "neutral",
                icon="ip",
            ),
            RiskGraphNode(
                id="mule",
                label="Mule Cluster #442",
                sublabel="Known laundering",
                x=620,
                y=200,
                kind="mule" if recipient_flagged else "neutral",
                icon="mule",
            ),
        ]
        edges = [
            RiskGraphEdge(
                source_id="user",
                target_id="target",
                label=f"{payload.currency} {payload.amount:,.2f} - attempted",
                flagged=decision != "APPROVED",
            ),
            RiskGraphEdge(
                source_id="target",
                target_id="ip",
                label=f"prior_tx={tx_count}",
                flagged=flagged_tx_count > 0,
            ),
            RiskGraphEdge(
                source_id="ip",
                target_id="mule",
                label=f"flagged_history={flagged_tx_count}",
                flagged=flagged_tx_count > 0,
            ),
            RiskGraphEdge(
                source_id="target",
                target_id="mule",
                label=f"max_risk={max_risk_score}",
                flagged=max_risk_score >= 70,
            ),
        ]
        latency_ms = int((time.perf_counter() - start) * 1000)
        return RiskGraphResponse(
            decision=decision,
            risk_score=risk_score,
            reason_codes=sorted(set(reasons)),
            latency_ms=latency_ms,
            stats=RiskGraphStats(
                tx_count=tx_count,
                max_risk_score=max_risk_score,
                flagged_tx_count=flagged_tx_count,
                source=source,
            ),
            nodes=nodes,
            edges=edges,
        )

    def persist_transfer(
        self,
        payload: TransferEvaluateRequest,
        result: RiskCheckResult,
        *,
        requires_hitl: bool | None = None,
    ) -> str:
        if self._graph_client is None:
            raise RuntimeError("Graph client is not configured")

        if requires_hitl is None:
            requires_hitl = result.decision != "APPROVED"
        status = "pending_hitl" if requires_hitl else "approved"
        tx_id = payload.transaction_id or f"tx:{uuid.uuid4().hex}"
        tx_time = payload.tx_time or datetime.now(tz=timezone.utc).isoformat()
        updated_at_epoch = int(time.time())

        self._graph_client.upsert_transfer(
            sender_user_id=payload.user_id,
            recipient_user_id=payload.recipient_id,
            transaction_id=tx_id,
            tx_time=tx_time,
            amount=payload.amount,
            currency=payload.currency,
            message_text=payload.message,
            tx_note=payload.tx_note,
            channel=payload.channel,
            status=status,
            finbert_score=100 if "FINBERT_NEGATIVE_HIGH" in result.reason_codes else 0,
            emotion_score=100 if "EMOTION_PRESSURE_HIGH" in result.reason_codes else 0,
            risk_score_latest=result.risk_score,
            risk_reason_codes=result.reason_codes,
            risk_decision=result.decision,
            requires_hitl=requires_hitl,
            updated_at_epoch=updated_at_epoch,
        )
        return tx_id

    def update_transfer_status(self, transaction_id: str, status: str) -> bool:
        if self._graph_client is None:
            raise RuntimeError("Graph client is not configured")
        return self._graph_client.update_transfer_status(
            transaction_id=transaction_id,
            status=status,
            updated_at_epoch=int(time.time()),
        )

    @staticmethod
    def _score_message(message: str) -> tuple[int, list[str]]:
        m = message.lower()
        score = 0
        reasons: list[str] = []

        finbert_negative_terms = ("guaranteed return", "double money", "easy profit", "urgent transfer")
        if any(term in m for term in finbert_negative_terms):
            score += 25
            reasons.append("FINBERT_NEGATIVE_HIGH")

        emotion_terms = ("panic", "fear", "desperate", "quick", "immediately")
        if any(term in m for term in emotion_terms):
            score += 15
            reasons.append("EMOTION_PRESSURE_HIGH")

        return score, reasons

    @staticmethod
    def _score_amount(amount: float) -> tuple[int, list[str]]:
        if amount >= 10000:
            return 30, ["AMOUNT_ANOMALY_CRITICAL"]
        if amount >= 3000:
            return 15, ["AMOUNT_ANOMALY_MEDIUM"]
        return 0, []

    @staticmethod
    def _decision_for_score(score: int) -> tuple[int, str]:
        capped_score = max(0, min(100, score))
        decision = "APPROVED"
        if capped_score >= 70:
            decision = "INTERVENTION_REQUIRED"
        elif capped_score >= 40:
            decision = "WARNING"
        return capped_score, decision


def build_graph(engine: RiskEngine):
    graph = StateGraph(FlowState)

    def risk_node(state: FlowState) -> FlowState:
        risk = engine.evaluate(state["request"])
        return {"risk": risk}

    graph.add_node("risk_check", risk_node)
    graph.add_edge(START, "risk_check")
    graph.add_edge("risk_check", END)
    return graph.compile()
