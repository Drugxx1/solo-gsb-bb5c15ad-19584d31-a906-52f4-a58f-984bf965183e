"""FastAPI 入口：釉料配方反推服务。"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import SolveRequest, SolveResponse
from .solver import solve_recipe

app = FastAPI(title="釉料配方反推 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/solve", response_model=SolveResponse)
def solve(req: SolveRequest) -> SolveResponse:
    return solve_recipe(req.oxides, req.target, req.materials)
