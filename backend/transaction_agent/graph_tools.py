import json
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ProfileNotFound
from langgraph.config import get_stream_writer

from app.core.config import Settings
from app.schemas.transfer import TransferEvaluateRequest
from app.services.risk_engine import NeptuneRiskClient, RiskEngine


USER_NODE_FIELDS = [
    "~id",
    "name",
    "balance",
    "ekyc_status",
    "ekyc_level",
    "hashed_phone",
    "hashed_ic",
    "risk_tier_current",
    "summary_text_latest",
    "summary_updated_at",
    "summary_agent_version",
    "created_at",
    "updated_at",
]

TRANSFER_EDGE_FIELDS = [
    "~id",
    "tx_time",
    "amount",
    "currency",
    "message_text",
    "tx_note",
    "channel",
    "status",
    "finbert_score",
    "emotion_score",
    "risk_score_latest",
    "risk_reason_codes",
    "updated_at",
]


def _emit_progress(status: str, detail: str) -> None:
    try:
        writer = get_stream_writer()
    except RuntimeError:
        return
    writer({"status": status, "detail": detail})


def _build_risk_engine() -> RiskEngine:
    settings = Settings()
    graph_client = None
    if settings.neptune_endpoint:
        graph_client = NeptuneRiskClient(
            endpoint=settings.neptune_endpoint,
            region=settings.aws_region,
            profile=settings.aws_profile or None,
        )
    return RiskEngine(graph_client=graph_client)


def _build_payload(
    user_id: str,
    recipient_id: str,
    amount: float,
    message: str,
    currency: str = "MYR",
    recipient_is_new: bool = False,
    channel: str = "voice_agent",
) -> TransferEvaluateRequest:
    return TransferEvaluateRequest(
        user_id=user_id,
        recipient_id=recipient_id,
        amount=amount,
        message=message,
        currency=currency,
        recipient_is_new=recipient_is_new,
        channel=channel,
    )


def search_contact_nodes_tool(query: str, limit: int = 5) -> dict[str, Any]:
    """Search contact nodes in the transaction graph by recipient name/identifier."""
    _emit_progress("finding_contacts", f"Searching contacts for {query}")
    settings = Settings()
    q = query.strip().lower()
    if not q:
        return {"query": query, "contacts": []}

    if settings.neptune_endpoint:
        try:
            try:
                session = boto3.Session(
                    profile_name=settings.aws_profile or None,
                    region_name=settings.aws_region,
                )
            except ProfileNotFound:
                session = boto3.Session(region_name=settings.aws_region)

            client = session.client(
                "neptunedata",
                endpoint_url=f"https://{settings.neptune_endpoint}:8182",
                config=Config(connect_timeout=1, read_timeout=2, retries={"max_attempts": 1, "mode": "standard"}),
            )

            cypher = (
                "MATCH (u:User) "
                "WHERE toLower(coalesce(u.name, '')) CONTAINS toLower($q) "
                "OR toLower(u.`~id`) CONTAINS toLower($q) "
                "RETURN u.`~id` AS graph_id, u.name AS display_name "
                "LIMIT $limit"
            )
            params = json.dumps({"q": q, "limit": max(1, int(limit))})
            response = client.execute_open_cypher_query(openCypherQuery=cypher, parameters=params)
            rows = response.get("results", [])
            contacts = []
            for row in rows:
                graph_id = str(row.get("graph_id", ""))
                user_id = graph_id.split(":", 1)[1] if graph_id.startswith("user:") else graph_id
                display_name = str(row.get("display_name", "")).strip() or user_id.replace("_", " ").replace("-", " ").title()
                contacts.append({"user_id": user_id, "graph_id": graph_id, "display_name": display_name})
            return {"query": query, "contacts": contacts}
        except Exception as exc:  # noqa: BLE001
            return {"query": query, "contacts": [], "error": f"neptune_search_failed: {exc}"}

    return {
        "query": query,
        "contacts": [],
        "error": "neptune_not_configured",
    }


def get_user_node_info_tool(user_id: str) -> dict[str, Any]:
    """Fetch a User node by id using the Neptune User schema fields."""
    _emit_progress("checking_user_node", f"Reading User node {user_id}")
    settings = Settings()
    graph_id = _to_graph_user_id(user_id)

    if settings.neptune_endpoint:
        try:
            client = _neptune_data_client(settings)
            returns = ", ".join([f"u.`{field}` AS `{field}`" for field in USER_NODE_FIELDS])
            cypher = f"MATCH (u:User {{`~id`: $user_id}}) RETURN {returns} LIMIT 1"
            response = client.execute_open_cypher_query(
                openCypherQuery=cypher,
                parameters=json.dumps({"user_id": graph_id}),
            )
            rows = response.get("results", [])
            return {
                "user_id": user_id,
                "graph_id": graph_id,
                "schema": "(:User)",
                "fields": USER_NODE_FIELDS,
                "node": rows[0] if rows else None,
                "source": "neptune",
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "user_id": user_id,
                "graph_id": graph_id,
                "schema": "(:User)",
                "fields": USER_NODE_FIELDS,
                "node": None,
                "source": "neptune",
                "error": f"neptune_user_lookup_failed: {exc}",
            }

    return {
        "user_id": user_id,
        "graph_id": graph_id,
        "schema": "(:User)",
        "fields": USER_NODE_FIELDS,
        "node": None,
        "source": "none",
        "error": "neptune_not_configured",
    }


def get_transfer_edges_info_tool(
    source_user_id: str,
    target_user_id: str,
    limit: int = 10,
) -> dict[str, Any]:
    """Fetch recent User-[:TRANSFERRED_TO]->User edges using the Neptune transaction edge schema."""
    _emit_progress("checking_transfer_edges", f"Reading TRANSFERRED_TO edges {source_user_id} -> {target_user_id}")
    settings = Settings()
    source_graph_id = _to_graph_user_id(source_user_id)
    target_graph_id = _to_graph_user_id(target_user_id)
    safe_limit = max(1, min(int(limit), 25))

    if settings.neptune_endpoint:
        try:
            client = _neptune_data_client(settings)
            returns = ", ".join([f"t.`{field}` AS `{field}`" for field in TRANSFER_EDGE_FIELDS])
            cypher = (
                "MATCH (u:User {`~id`: $source_id})-[t:TRANSFERRED_TO]->(r:User {`~id`: $target_id}) "
                f"RETURN {returns} "
                "ORDER BY t.tx_time DESC "
                "LIMIT $limit"
            )
            response = client.execute_open_cypher_query(
                openCypherQuery=cypher,
                parameters=json.dumps(
                    {"source_id": source_graph_id, "target_id": target_graph_id, "limit": safe_limit}
                ),
            )
            return {
                "source_user_id": source_user_id,
                "target_user_id": target_user_id,
                "schema": "(:User)-[:TRANSFERRED_TO]->(:User)",
                "fields": TRANSFER_EDGE_FIELDS,
                "edges": response.get("results", []),
                "source": "neptune",
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "source_user_id": source_user_id,
                "target_user_id": target_user_id,
                "schema": "(:User)-[:TRANSFERRED_TO]->(:User)",
                "fields": TRANSFER_EDGE_FIELDS,
                "edges": [],
                "source": "neptune",
                "error": f"neptune_edge_lookup_failed: {exc}",
            }

    if settings.use_mock_graph:
        edges_by_pair = {
            ("user:marcus", "user:ali"): [
                {
                    "~id": "tx:mock_ali_001",
                    "tx_time": "2026-04-21T09:10:00Z",
                    "amount": 12.5,
                    "currency": "MYR",
                    "message_text": "lunch",
                    "tx_note": "food",
                    "channel": "wallet_app",
                    "status": "approved",
                    "finbert_score": 0,
                    "emotion_score": 0,
                    "risk_score_latest": 12,
                    "risk_reason_codes": "[]",
                    "updated_at": 1776900000,
                },
                {
                    "~id": "tx:mock_ali_002",
                    "tx_time": "2026-04-23T15:30:00Z",
                    "amount": 2,
                    "currency": "MYR",
                    "message_text": "teh ais",
                    "tx_note": None,
                    "channel": "wallet_app",
                    "status": "approved",
                    "finbert_score": 0,
                    "emotion_score": 0,
                    "risk_score_latest": 8,
                    "risk_reason_codes": "[]",
                    "updated_at": 1777000000,
                },
            ],
            ("user:marcus", "user:investment_agent"): [
                {
                    "~id": "tx:mock_inv_001",
                    "tx_time": "2026-04-22T10:00:00Z",
                    "amount": 1000,
                    "currency": "MYR",
                    "message_text": "guaranteed return deposit",
                    "tx_note": "telegram investment",
                    "channel": "wallet_app",
                    "status": "warned",
                    "finbert_score": 92,
                    "emotion_score": 88,
                    "risk_score_latest": 82,
                    "risk_reason_codes": "[\"high_risk_summary\", \"warned_history\"]",
                    "updated_at": 1777000000,
                }
            ],
        }
        edges = edges_by_pair.get((source_graph_id, target_graph_id), [])
        return {
            "source_user_id": source_user_id,
            "target_user_id": target_user_id,
            "schema": "(:User)-[:TRANSFERRED_TO]->(:User)",
            "fields": TRANSFER_EDGE_FIELDS,
            "edges": edges[:safe_limit],
            "source": "mock",
        }

    return {
        "source_user_id": source_user_id,
        "target_user_id": target_user_id,
        "schema": "(:User)-[:TRANSFERRED_TO]->(:User)",
        "fields": TRANSFER_EDGE_FIELDS,
        "edges": [],
        "source": "none",
    }


def get_neptune_graph_overview_tool(user_limit: int = 5, edge_limit: int = 5) -> dict[str, Any]:
    """Fetch graph counts and recent User/TRANSFERRED_TO samples for grounding."""
    settings = Settings()
    safe_user_limit = max(1, min(int(user_limit), 20))
    safe_edge_limit = max(1, min(int(edge_limit), 20))

    if settings.neptune_endpoint:
        try:
            client = _neptune_data_client(settings)

            users_count_response = client.execute_open_cypher_query(
                openCypherQuery="MATCH (u:User) RETURN count(u) AS user_count",
            )
            edges_count_response = client.execute_open_cypher_query(
                openCypherQuery="MATCH ()-[t:TRANSFERRED_TO]->() RETURN count(t) AS transfer_count",
            )
            users_response = client.execute_open_cypher_query(
                openCypherQuery=(
                    "MATCH (u:User) "
                    "RETURN u.`~id` AS graph_id, u.name AS name, u.risk_tier_current AS risk_tier_current "
                    "ORDER BY coalesce(u.updated_at, 0) DESC "
                    "LIMIT $limit"
                ),
                parameters=json.dumps({"limit": safe_user_limit}),
            )
            edges_response = client.execute_open_cypher_query(
                openCypherQuery=(
                    "MATCH (s:User)-[t:TRANSFERRED_TO]->(r:User) "
                    "RETURN s.`~id` AS source_id, r.`~id` AS target_id, t.amount AS amount, t.currency AS currency, "
                    "t.tx_time AS tx_time, t.risk_score_latest AS risk_score_latest "
                    "ORDER BY coalesce(t.updated_at, 0) DESC "
                    "LIMIT $limit"
                ),
                parameters=json.dumps({"limit": safe_edge_limit}),
            )

            user_count = 0
            transfer_count = 0
            if users_count_response.get("results"):
                user_count = int(users_count_response["results"][0].get("user_count", 0))
            if edges_count_response.get("results"):
                transfer_count = int(edges_count_response["results"][0].get("transfer_count", 0))

            return {
                "source": "neptune",
                "counts": {"users": user_count, "transfers": transfer_count},
                "sample_users": users_response.get("results", []),
                "sample_transfers": edges_response.get("results", []),
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "source": "neptune",
                "counts": {"users": 0, "transfers": 0},
                "sample_users": [],
                "sample_transfers": [],
                "error": f"neptune_overview_failed: {exc}",
            }

    if settings.use_mock_graph:
        return {
            "source": "mock",
            "counts": {"users": 4, "transfers": 3},
            "sample_users": [
                {"graph_id": "user:marcus", "name": "Marcus", "risk_tier_current": "low"},
                {"graph_id": "user:ali", "name": "Ali", "risk_tier_current": "low"},
                {"graph_id": "user:investment_agent", "name": "Investment Agent", "risk_tier_current": "high"},
                {"graph_id": "user:siti", "name": "Siti", "risk_tier_current": "medium"},
            ][:safe_user_limit],
            "sample_transfers": [
                {"source_id": "user:marcus", "target_id": "user:ali", "amount": 12.5, "currency": "MYR"},
                {"source_id": "user:marcus", "target_id": "user:ali", "amount": 2.0, "currency": "MYR"},
                {"source_id": "user:marcus", "target_id": "user:investment_agent", "amount": 1000.0, "currency": "MYR"},
            ][:safe_edge_limit],
        }

    return {
        "source": "none",
        "counts": {"users": 0, "transfers": 0},
        "sample_users": [],
        "sample_transfers": [],
    }


def _to_graph_user_id(user_id: str) -> str:
    return user_id if user_id.startswith("user:") else f"user:{user_id}"


def _neptune_data_client(settings: Settings):
    try:
        session = boto3.Session(
            profile_name=settings.aws_profile or None,
            region_name=settings.aws_region,
        )
    except ProfileNotFound:
        session = boto3.Session(region_name=settings.aws_region)

    return session.client(
        "neptunedata",
        endpoint_url=f"https://{settings.neptune_endpoint}:8182",
        config=Config(connect_timeout=1, read_timeout=2, retries={"max_attempts": 1, "mode": "standard"}),
    )


def search_transaction_graph_tool(
    user_id: str,
    recipient_id: str,
    amount: float,
    message: str,
    currency: str = "MYR",
    recipient_is_new: bool = False,
) -> dict[str, Any]:
    """Build a graph-shaped risk payload for transfer analysis."""
    engine = _build_risk_engine()
    payload = _build_payload(
        user_id=user_id,
        recipient_id=recipient_id,
        amount=amount,
        message=message,
        currency=currency,
        recipient_is_new=recipient_is_new,
    )
    return engine.build_risk_graph(payload).model_dump()


def inspect_graph_node_tool(
    node_id: str,
    user_id: str,
    recipient_id: str,
    amount: float,
    message: str,
    currency: str = "MYR",
    recipient_is_new: bool = False,
) -> dict[str, Any]:
    """Inspect one node and all adjacent edges from the risk graph response."""
    graph = search_transaction_graph_tool(
        user_id=user_id,
        recipient_id=recipient_id,
        amount=amount,
        message=message,
        currency=currency,
        recipient_is_new=recipient_is_new,
    )
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    node = next((n for n in nodes if n.get("id") == node_id), None)
    adjacent = [
        edge
        for edge in edges
        if edge.get("source_id") == node_id or edge.get("target_id") == node_id
    ]
    return {
        "node": node,
        "adjacent_edges": adjacent,
        "source": graph.get("stats", {}).get("source", "unknown"),
    }


def inspect_graph_edge_tool(
    source_id: str,
    target_id: str,
    user_id: str,
    recipient_id: str,
    amount: float,
    message: str,
    currency: str = "MYR",
    recipient_is_new: bool = False,
) -> dict[str, Any]:
    """Inspect one directional edge from the risk graph response."""
    graph = search_transaction_graph_tool(
        user_id=user_id,
        recipient_id=recipient_id,
        amount=amount,
        message=message,
        currency=currency,
        recipient_is_new=recipient_is_new,
    )
    edges = graph.get("edges", [])
    edge = next(
        (
            e
            for e in edges
            if e.get("source_id") == source_id and e.get("target_id") == target_id
        ),
        None,
    )
    return {
        "edge": edge,
        "source": graph.get("stats", {}).get("source", "unknown"),
    }
