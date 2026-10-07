"""Servicio de análisis del Kanban (Python + FastAPI).

Es un servicio sin estado: no tiene base de datos ni credenciales. La API de Node
verifica permisos, reúne los datos del tablero y se los envía aquí para analizarlos.
"""
import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException

from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.service import analyze

app = FastAPI(
    title="Kanban ML",
    version="1.0.0",
    description="Throughput, tendencia, pronóstico Monte Carlo, predicción de tiempos y tarjetas estancadas.",
)


def check_token(x_ml_token: str | None = Header(default=None)) -> None:
    """Si ML_TOKEN está definido, solo acepta llamadas que lo traigan (la API de Node)."""
    expected = os.environ.get("ML_TOKEN")
    if expected and not (x_ml_token and secrets.compare_digest(x_ml_token, expected)):
        raise HTTPException(status_code=401, detail="Token inválido")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse, dependencies=[Depends(check_token)])
def analyze_board(req: AnalyzeRequest) -> AnalyzeResponse:
    try:
        return analyze(req)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
