from fastapi import APIRouter, Depends

from app.api.dependencies import get_risk_engine
from app.schemas.transfer import RiskCheckResult, RiskGraphResponse, TransferEvaluateRequest
from app.services.risk_engine import RiskEngine

router = APIRouter()


def _evaluate(
    payload: TransferEvaluateRequest,
    risk_engine: RiskEngine,
) -> RiskCheckResult:
    return risk_engine.evaluate(payload)


@router.post("/risk/check", response_model=RiskCheckResult)
def risk_check(
    payload: TransferEvaluateRequest,
    risk_engine: RiskEngine = Depends(get_risk_engine),
) -> RiskCheckResult:
    return _evaluate(payload=payload, risk_engine=risk_engine)


@router.post("/risk/graph", response_model=RiskGraphResponse)
def risk_graph(
    payload: TransferEvaluateRequest,
    risk_engine: RiskEngine = Depends(get_risk_engine),
) -> RiskGraphResponse:
    return risk_engine.build_risk_graph(payload)
