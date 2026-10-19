"""Servicio de análisis del Kanban (Python + FastAPI).

Es un servicio sin estado: no tiene base de datos ni credenciales. La API de Node
verifica permisos, reúne los datos del tablero y se los envía aquí para analizarlos.

Configuración (variables de entorno):
- ML_TOKEN: secreto compartido con Node. Obligatorio en producción (mínimo 32 caracteres).
- ML_ENV=production: exige ML_TOKEN y oculta /docs y /openapi.json. La imagen Docker
  lo trae puesto; en desarrollo local no hace falta.
"""
import logging
import os
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.service import analyze

log = logging.getLogger("kanban.ml")

MIN_TOKEN_LENGTH = 32
MAX_BODY_BYTES = 10 * 1024 * 1024  # 10 MB alcanzan para los topes de schemas.py


def is_production() -> bool:
    return os.environ.get("ML_ENV") == "production"


def check_config() -> None:
    """En producción el servicio NO arranca sin un token fuerte (falla cerrado)."""
    token = os.environ.get("ML_TOKEN", "")
    if is_production() and len(token) < MIN_TOKEN_LENGTH:
        raise RuntimeError(
            f"ML_TOKEN es obligatorio en producción (mínimo {MIN_TOKEN_LENGTH} caracteres)"
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    check_config()
    yield


def check_token(x_ml_token: str | None = Header(default=None)) -> None:
    """Solo acepta llamadas con el secreto compartido (la API de Node).

    Sin ML_TOKEN configurado solo se permite fuera de producción (desarrollo local).
    """
    expected = os.environ.get("ML_TOKEN")
    if not expected:
        if is_production():
            raise HTTPException(status_code=503, detail="Servicio sin configurar")
        return
    # compare_digest sobre bytes: con str, un carácter no ASCII lanzaba TypeError (500).
    if not (x_ml_token and secrets.compare_digest(x_ml_token.encode(), expected.encode())):
        raise HTTPException(status_code=401, detail="Token inválido")


def create_app() -> FastAPI:
    """Crea la app. La configuración de producción se lee al crearla (ver tests)."""
    prod = is_production()
    app = FastAPI(
        title="Kanban ML",
        version="1.1.0",
        description="Throughput, tendencia, pronóstico Monte Carlo, predicción de tiempos y tarjetas estancadas.",
        lifespan=lifespan,
        # En producción no se publica la documentación interactiva ni el esquema.
        docs_url=None if prod else "/docs",
        redoc_url=None if prod else "/redoc",
        openapi_url=None if prod else "/openapi.json",
    )

    @app.middleware("http")
    async def limit_body_size(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """Rechaza cuerpos enormes antes de leerlos (uvicorn no tiene un límite propio)."""
        if request.method == "POST":
            length = request.headers.get("content-length")
            if length is None:
                return JSONResponse({"detail": "Falta Content-Length"}, status_code=411)
            if not length.isdigit() or int(length) > MAX_BODY_BYTES:
                return JSONResponse({"detail": "Cuerpo demasiado grande"}, status_code=413)
        return await call_next(request)

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        # El detalle va al log, nunca al cliente.
        log.exception("Error inesperado en el análisis", exc_info=exc)
        return JSONResponse({"detail": "Error interno"}, status_code=500)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/analyze", response_model=AnalyzeResponse, dependencies=[Depends(check_token)])
    def analyze_board(req: AnalyzeRequest) -> AnalyzeResponse:
        try:
            return analyze(req)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

    return app


app = create_app()
