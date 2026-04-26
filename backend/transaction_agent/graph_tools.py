import json
from typing import Any

from botocore.config import Config
from langgraph.config import get_stream_writer

from app.core.config import Settings
from app.schemas.transfer import TransferEvaluateRequest
from app.services.aws_session import build_boto3_session
from app.services.risk_engine import NeptuneRiskClient, RiskEngine
from app.services.transfer_summary import update_transfer_participant_summaries


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

USER_NODE_RETURNS = ", ".join([f"u.`{field}` AS `{field}`" for field in USER_NODE_FIELDS])

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
    if not settings.neptune_endpoint:
        raise RuntimeError("NEPTUNE_ENDPOINT is required. Mock graph mode has been removed.")
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
            session = build_boto3_session(
                region=settings.aws_region,
                profile=settings.aws_profile or None,
            )

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
                "ORDER BY toLower(coalesce(u.name, u.`~id`)) "
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
            candidates = _candidate_user_ids(user_id)
            cypher = (
                "MATCH (u:User) "
                "WHERE u.`~id` IN $candidates OR u.user_id IN $candidates "
                f"RETURN {USER_NODE_RETURNS} "
                "ORDER BY "
                "CASE WHEN u.balance IS NULL THEN 1 ELSE 0 END, "
                "CASE WHEN u.user_id = $raw_user_id THEN 0 ELSE 1 END "
                "LIMIT 1"
            )
            response = client.execute_open_cypher_query(
                openCypherQuery=cypher,
                parameters=json.dumps({"candidates": candidates, "raw_user_id": user_id}),
            )
            rows = response.get("results", [])
            resolved_graph_id = str(rows[0].get("~id", graph_id)) if rows else graph_id
            return {
                "user_id": user_id,
                "graph_id": resolved_graph_id,
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
    safe_limit = max(1, min(int(limit), 25))

    if settings.neptune_endpoint:
        try:
            client = _neptune_data_client(settings)
            source_graph_id = _resolve_graph_user_id(client, source_user_id)
            target_graph_id = _resolve_graph_user_id(client, target_user_id)
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

    return {
        "source_user_id": source_user_id,
        "target_user_id": target_user_id,
        "schema": "(:User)-[:TRANSFERRED_TO]->(:User)",
        "fields": TRANSFER_EDGE_FIELDS,
        "edges": [],
        "source": "none",
        "error": "neptune_not_configured",
    }


def update_transfer_participant_summaries_tool(transaction_id: str) -> dict[str, Any]:
    """Update sender and recipient User summaries from a settled transfer edge."""
    _emit_progress("updating_summaries", "Updating transfer summaries")
    return update_transfer_participant_summaries(transaction_id)


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

    return {
        "source": "none",
        "counts": {"users": 0, "transfers": 0},
        "sample_users": [],
        "sample_transfers": [],
        "error": "neptune_not_configured",
    }


def _to_graph_user_id(user_id: str) -> str:
    return user_id if user_id.startswith("user:") else f"user:{user_id}"


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

    deduped: list[str] = []
    for value in candidates:
        if value not in deduped:
            deduped.append(value)
    return deduped


def _resolve_graph_user_id(client: Any, raw_user_id: str) -> str:
    candidates = _candidate_user_ids(raw_user_id)
    response = client.execute_open_cypher_query(
        openCypherQuery=(
            "MATCH (u:User) "
            "WHERE u.`~id` IN $candidates OR u.user_id IN $candidates "
            "RETURN u.`~id` AS graph_id "
            "ORDER BY "
            "CASE WHEN u.balance IS NULL THEN 1 ELSE 0 END, "
            "CASE WHEN u.user_id = $raw_user_id THEN 0 ELSE 1 END "
            "LIMIT 1"
        ),
        parameters=json.dumps({"candidates": candidates, "raw_user_id": raw_user_id}),
    )
    rows = response.get("results", [])
    if rows and rows[0].get("graph_id"):
        return str(rows[0]["graph_id"])
    return _to_graph_user_id(raw_user_id)


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
