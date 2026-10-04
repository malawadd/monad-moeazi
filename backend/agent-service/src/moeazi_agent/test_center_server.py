from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from .config import get_settings
from .storage import AnalysisRepository
from .test_center_api import router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.repository = AnalysisRepository(settings.postgres_dsn)
    app.state.redis = Redis.from_url(settings.redis_url)
    yield
    await app.state.redis.aclose()


app = FastAPI(title="Moeazi Isolated Test Center", version="0.1.0", lifespan=lifespan)
app.include_router(router)
