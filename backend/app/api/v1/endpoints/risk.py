from fastapi import APIRouter, Depends

from app.api.dependencies import get_risk_engine
from app.schemas.transfer import RiskCheckResult, TransferEvaluateRequest
from app.services.risk_engine import RiskEngine

router = APIRouter()


@router.post("/risk/check", response_model=RiskCheckResult)
def risk_check(
    payload: TransferEvaluateRequest,
    risk_engine: RiskEngine = Depends(get_risk_engine),
) -> RiskCheckResult:
    return risk_engine.evaluate(payload)

