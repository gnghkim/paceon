"""Process health only; AI processing is introduced in a later phase."""

from typing import Literal

from fastapi import FastAPI, Response
from pydantic import BaseModel

app = FastAPI(title="PaceOn AI Worker", version="0.0.0")


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["ai-worker"] = "ai-worker"
    check: Literal["liveness"] = "liveness"


@app.get("/health", response_model=HealthResponse)
def health(response: Response) -> HealthResponse:
    response.headers["Cache-Control"] = "no-store"
    return HealthResponse()
