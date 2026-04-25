import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from transaction_agent import build_main_deep_agent
from app.api.v1.router import api_router
from app.core.config import Settings
from app.services.risk_engine import MockGraphRiskClient, NeptuneRiskClient, RiskEngine, build_graph
from app.services.warnings import InMemoryWarningStore

logger = logging.getLogger(__name__)


class _GoogleToolCallTextWarningFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not (
            record.name == "google_genai.types"
            and "non-text parts in the response" in message
            and "function_call" in message
        )


def create_app() -> FastAPI:
    settings = Settings()
    logging.getLogger("google_genai.types").addFilter(_GoogleToolCallTextWarningFilter())

    graph_client = None
    if settings.use_mock_graph:
        graph_client = MockGraphRiskClient(assumed_user_id=settings.dev_user_id)
    elif settings.neptune_endpoint:
        graph_client = NeptuneRiskClient(
            endpoint=settings.neptune_endpoint,
            region=settings.aws_region,
            profile=settings.aws_profile or None,
        )

    risk_engine = RiskEngine(graph_client=graph_client)

    app = FastAPI(title=settings.app_name, version=settings.app_version)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.api_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.risk_engine = risk_engine
    app.state.flow_graph = build_graph(risk_engine)
    app.state.warning_store = InMemoryWarningStore()
    app.state.warning_delay_seconds = settings.warning_delay_seconds
    try:
        api_key = settings.google_api_key or settings.gemini_api_key or None
        app.state.main_agent = build_main_deep_agent(
            model=settings.main_agent_model,
            model_provider=settings.main_agent_model_provider,
            api_key=api_key,
        )
        app.state.main_agent_error = None
    except Exception:  # noqa: BLE001
        logger.exception("Failed to initialize main agent")
        # Keep API bootable even if model runtime is unavailable.
        app.state.main_agent = None
        app.state.main_agent_error = "main_agent_init_failed"
    app.include_router(api_router)
    return app


app = create_app()
