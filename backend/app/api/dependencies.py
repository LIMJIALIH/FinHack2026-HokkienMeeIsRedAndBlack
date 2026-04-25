from typing import Any

from fastapi import Request

from app.services.risk_engine import RiskEngine
from app.services.wallet_ledger import WalletLedger
from app.services.warnings import InMemoryWarningStore


def get_risk_engine(request: Request) -> RiskEngine:
    return request.app.state.risk_engine


def get_flow_graph(request: Request) -> Any:
    return request.app.state.flow_graph


def get_warning_store(request: Request) -> InMemoryWarningStore:
    return request.app.state.warning_store


def get_wallet_ledger(request: Request) -> WalletLedger:
    return request.app.state.wallet_ledger


def get_main_agent(request: Request):
    return request.app.state.main_agent
