from typing import Any

from fastapi import Request

from app.services.risk_engine import RiskEngine
from app.services.warnings import InMemoryWarningStore


def get_risk_engine(request: Request) -> RiskEngine:
    return request.app.state.risk_engine


def get_flow_graph(request: Request) -> Any:
    return request.app.state.flow_graph


def get_warning_store(request: Request) -> InMemoryWarningStore:
    return request.app.state.warning_store
