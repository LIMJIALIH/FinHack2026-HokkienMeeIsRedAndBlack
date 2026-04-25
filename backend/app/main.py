from fastapi import FastAPI

from app.api.v1.router import api_router
from app.core.config import Settings
from app.services.risk_engine import NeptuneRiskClient, RiskEngine, build_graph
from app.services.warnings import InMemoryWarningStore


def create_app() -> FastAPI:
    settings = Settings()

    neptune_client = None
    if settings.neptune_endpoint:
        neptune_client = NeptuneRiskClient(
            endpoint=settings.neptune_endpoint,
            region=settings.aws_region,
            profile=settings.aws_profile or None,
        )

    risk_engine = RiskEngine(neptune_client=neptune_client)

    app = FastAPI(title=settings.app_name, version=settings.app_version)
    app.state.risk_engine = risk_engine
    app.state.flow_graph = build_graph(risk_engine)
    app.state.warning_store = InMemoryWarningStore()
    app.state.warning_delay_seconds = settings.warning_delay_seconds
    app.include_router(api_router)
    return app


app = create_app()
