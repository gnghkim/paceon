"""Liveness endpoint and configured durable AI consumer."""

import asyncio
import threading
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Response
from pydantic import BaseModel

from app.worker import Settings, Worker
from app.pdf_worker import PdfSettings, PdfWorker


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    stop = threading.Event()
    pdf_settings = PdfSettings.from_env()
    consumers = []
    if settings.enabled:
        consumers.append(Worker(settings))
    if pdf_settings.enabled:
        consumers.append(PdfWorker(pdf_settings))
    tasks = [asyncio.create_task(asyncio.to_thread(consumer.run, stop)) for consumer in consumers]
    try:
        yield
    finally:
        stop.set()
        if tasks:
            await asyncio.gather(*tasks)


app = FastAPI(title="PaceOn AI Worker", version="0.0.0", lifespan=lifespan)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["ai-worker"] = "ai-worker"
    check: Literal["liveness"] = "liveness"


@app.get("/health", response_model=HealthResponse)
def health(response: Response) -> HealthResponse:
    response.headers["Cache-Control"] = "no-store"
    return HealthResponse()
