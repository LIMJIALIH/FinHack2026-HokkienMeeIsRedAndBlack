import json
import time
from typing import NotRequired, TypedDict

import boto3
from botocore.config import Config
from botocore.exceptions import ProfileNotFound
from langgraph.graph import END, START, StateGraph

from app.schemas.transfer import RiskCheckResult, TransferEvaluateRequest


class FlowState(TypedDict):
    request: TransferEvaluateRequest
    risk: NotRequired[RiskCheckResult]


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
        sender_graph_id = self._to_graph_user_id(user_id)
        recipient_graph_id = self._to_graph_user_id(recipient_id)
        query = (
            "MATCH (u:User)-[t:TRANSFERRED_TO]->(r:User) "
            "WHERE id(u) = $sender_id AND id(r) = $recipient_id "
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
        evidence = [
            f"graph:tx_count={tx_count}",
            f"graph:max_risk_score={max_risk_score}",
            f"graph:flagged_tx_count={flagged_tx_count}",
        ]
        return score, reasons, evidence, latency_ms

    @staticmethod
    def _to_graph_user_id(user_id: str) -> str:
        # Schema uses Neptune element IDs for user identity; support both plain and prefixed input.
        return user_id if user_id.startswith("user:") else f"user:{user_id}"


class RiskEngine:
    def __init__(self, neptune_client: NeptuneRiskClient | None) -> None:
        self._neptune = neptune_client

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
        if self._neptune is not None:
            try:
                graph_score, graph_reasons, graph_evidence, graph_latency = self._neptune.fetch_graph_risk(
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

        capped_score = max(0, min(100, score))
        decision = "APPROVED"
        if capped_score >= 70:
            decision = "INTERVENTION_REQUIRED"
        elif capped_score >= 40:
            decision = "WARNING"

        total_latency_ms = int((time.perf_counter() - start) * 1000)
        evidence.append(f"component:graph_latency_ms={graph_latency}")
        return RiskCheckResult(
            decision=decision,
            risk_score=capped_score,
            reason_codes=sorted(set(reasons)),
            evidence_refs=evidence,
            latency_ms=total_latency_ms,
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


def build_graph(engine: RiskEngine):
    graph = StateGraph(FlowState)

    def risk_node(state: FlowState) -> FlowState:
        risk = engine.evaluate(state["request"])
        return {"risk": risk}

    graph.add_node("risk_check", risk_node)
    graph.add_edge(START, "risk_check")
    graph.add_edge("risk_check", END)
    return graph.compile()
