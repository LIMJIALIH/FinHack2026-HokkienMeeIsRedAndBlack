from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="FinHack Backend")


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _graphson_decode(value: Any) -> Any:
    if isinstance(value, list):
        return [_graphson_decode(item) for item in value]

    if isinstance(value, dict):
        if "@type" in value and "@value" in value:
            gtype = value["@type"]
            gvalue = value["@value"]

            if gtype == "g:List":
                return [_graphson_decode(item) for item in gvalue]
            if gtype == "g:Map":
                decoded: dict[str, Any] = {}
                for i in range(0, len(gvalue), 2):
                    key = _graphson_decode(gvalue[i])
                    decoded[str(key)] = _graphson_decode(gvalue[i + 1])
                return decoded
            if gtype in {"g:Int32", "g:Int64", "g:Float", "g:Double", "g:Boolean"}:
                return gvalue
            if gtype in {"g:T", "g:Direction"}:
                return str(gvalue)
            return _graphson_decode(gvalue)

        return {str(k): _graphson_decode(v) for k, v in value.items()}

    return value


def _extract_result_rows(response: dict[str, Any]) -> list[dict[str, Any]]:
    raw = response.get("result", {}).get("data", {})
    decoded = _graphson_decode(raw)
    if isinstance(decoded, list):
        return [row for row in decoded if isinstance(row, dict)]
    return []


def _node_kind(node: dict[str, Any], index: int) -> str:
    if index == 0:
        return "user"

    risk_tier = str(node.get("risk_tier_current", "")).lower()
    status = str(node.get("status", "")).lower()
    risk_score = node.get("risk_score_latest")

    if risk_tier == "high" or status == "blocked":
        return "flagged"

    try:
        if risk_score is not None and float(risk_score) >= 0.7:
            return "mule"
    except (TypeError, ValueError):
        pass

    if risk_tier == "medium" or status == "warned":
        return "neutral"

    return "user"


def _node_icon(kind: str) -> str:
    if kind == "mule":
        return "mule"
    return "user"


def _edge_label(edge: dict[str, Any]) -> str:
    amount = edge.get("amount")
    currency = str(edge.get("currency", "")).strip()
    status = str(edge.get("status", "")).strip()

    parts: list[str] = []
    if amount is not None:
        try:
            parts.append(f"{currency} {float(amount):,.2f}".strip())
        except (TypeError, ValueError):
            parts.append(str(amount))
    if status:
        parts.append(status)

    if not parts:
        return str(edge.get("label", "transfer"))
    return " - ".join(parts)


def _layout_positions(node_ids: list[str]) -> dict[str, tuple[float, float]]:
    width = 720.0
    height = 400.0

    if not node_ids:
        return {}

    positions: dict[str, tuple[float, float]] = {node_ids[0]: (110.0, height / 2)}
    if len(node_ids) == 1:
        return positions

    center_x = 430.0
    center_y = height / 2
    radius = min(145.0, 60.0 + 25.0 * (len(node_ids) - 1))
    step = (2 * math.pi) / (len(node_ids) - 1)

    for idx, node_id in enumerate(node_ids[1:]):
        angle = -math.pi / 2 + idx * step
        x = center_x + radius * math.cos(angle)
        y = center_y + radius * math.sin(angle)
        x = max(70.0, min(width - 70.0, x))
        y = max(60.0, min(height - 60.0, y))
        positions[node_id] = (x, y)

    return positions


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/regulatory-dashboard/graph")
def regulatory_dashboard_graph() -> dict[str, Any]:
    endpoint = os.getenv(
        "NEPTUNE_ENDPOINT",
        "https://db-neptune-2.cluster-cjugq6yyw4j8.ap-southeast-1.neptune.amazonaws.com:8182",
    )
    region = os.getenv("AWS_REGION", "ap-southeast-1")
    profile = os.getenv("NEPTUNE_AWS_PROFILE")

    session = boto3.Session(profile_name=profile, region_name=region) if profile else boto3.Session(region_name=region)
    client = session.client("neptunedata", endpoint_url=endpoint)

    try:
        vertices_response = client.execute_gremlin_query(gremlinQuery="g.V().elementMap()")
        edges_response = client.execute_gremlin_query(gremlinQuery="g.E().elementMap()")
    except (ClientError, BotoCoreError) as exc:
        raise HTTPException(status_code=502, detail=f"Failed to query Neptune: {exc}") from exc

    vertex_rows = _extract_result_rows(vertices_response)
    edge_rows = _extract_result_rows(edges_response)

    node_ids: list[str] = []
    for row in vertex_rows:
        node_id = str(row.get("id", ""))
        if node_id:
            node_ids.append(node_id)

    positions = _layout_positions(node_ids)

    nodes: list[dict[str, Any]] = []
    for idx, row in enumerate(vertex_rows):
        node_id = str(row.get("id", ""))
        if not node_id:
            continue

        kind = _node_kind(row, idx)
        x, y = positions.get(node_id, (360.0, 200.0))
        name = str(row.get("name") or row.get("label") or node_id)
        status = str(row.get("status", "")).strip()
        sublabel = status if status else str(row.get("risk_tier_current", "")).strip()

        nodes.append(
            {
                "id": node_id,
                "label": name,
                "sublabel": sublabel,
                "x": round(x, 2),
                "y": round(y, 2),
                "kind": kind,
                "icon": _node_icon(kind),
            }
        )

    edges: list[dict[str, Any]] = []
    for row in edge_rows:
        src = row.get("OUT", {})
        dst = row.get("IN", {})
        from_id = str(src.get("id", "")) if isinstance(src, dict) else ""
        to_id = str(dst.get("id", "")) if isinstance(dst, dict) else ""
        if not from_id or not to_id:
            continue

        flagged = False
        status = str(row.get("status", "")).lower()
        risk_score = row.get("risk_score_latest")
        if status in {"blocked", "warned"}:
            flagged = True
        else:
            try:
                flagged = risk_score is not None and float(risk_score) >= 0.6
            except (TypeError, ValueError):
                flagged = False

        edges.append(
            {
                "id": str(row.get("id", f"{from_id}->{to_id}")),
                "from": from_id,
                "to": to_id,
                "label": _edge_label(row),
                "flagged": flagged,
            }
        )

    return {
        "source": "db-neptune-2",
        "region": region,
        "endpoint": endpoint,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "nodes": nodes,
        "edges": edges,
    }
from app.main import app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
    )
