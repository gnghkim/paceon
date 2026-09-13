"""Liveness endpoint and configured durable AI consumer."""

import asyncio
import threading
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Response
from pydantic import BaseModel

from app.worker import Settings, Worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    stop = threading.Event()
    task = asyncio.create_task(asyncio.to_thread(Worker(settings).run, stop)) if settings.enabled else None
    try:
        yield
    finally:
        stop.set()
        if task is not None:
            await task


app = FastAPI(title="PaceOn AI Worker", version="0.0.0", lifespan=lifespan)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["ai-worker"] = "ai-worker"
    check: Literal["liveness"] = "liveness"


@app.get("/health", response_model=HealthResponse)
def health(response: Response) -> HealthResponse:
    response.headers["Cache-Control"] = "no-store"
    return HealthResponse()
