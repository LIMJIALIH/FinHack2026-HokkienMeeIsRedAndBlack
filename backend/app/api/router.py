from fastapi import APIRouter

from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.regulatory import router as regulatory_router
from app.api.v1.endpoints.speech import router as speech_router

api_router = APIRouter()
api_router.include_router(health_router, prefix="/api/v1", tags=["health"])
api_router.include_router(speech_router, prefix="/api/v1", tags=["speech"])
api_router.include_router(regulatory_router, prefix="/api/v1", tags=["regulatory"])
