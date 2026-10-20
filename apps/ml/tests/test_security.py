"""Tests de regresión de los hallazgos de seguridad (fase 1 del estudio).

Cada test lleva en el nombre el ID del hallazgo que cubre (S-xx). Si alguno falla,
el problema volvió.
"""
import random
import time
import tracemalloc
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.analysis import forecast
from app.analysis.timeline import build, wip_at
from app.main import create_app, unresolved_key_vault_references
from app.schemas import MAX_CARDS, MAX_SIMULATIONS, AnalyzeRequest
from app.service import analyze
from tests.factory import COLUMNS, NOW, BoardBuilder, steady_board

TOKEN = "t" * 40


def payload(**overrides):
    data = steady_board(per_week=4, weeks=8, pending=5).request().model_dump(mode="json", by_alias=True)
    data.update(overrides)
    return data


@pytest.fixture
def prod_env(monkeypatch):
    monkeypatch.setenv("ML_ENV", "production")
    monkeypatch.setenv("ML_TOKEN", TOKEN)


# ---------- S-06: el token falla cerrado ----------

def test_s06_produccion_no_arranca_sin_token(monkeypatch):
    monkeypatch.setenv("ML_ENV", "production")
    monkeypatch.delenv("ML_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="ML_TOKEN"), TestClient(create_app()):
        pass


def test_s06_produccion_no_arranca_con_token_corto(monkeypatch):
    monkeypatch.setenv("ML_ENV", "production")
    monkeypatch.setenv("ML_TOKEN", "corto")
    with pytest.raises(RuntimeError, match="ML_TOKEN"), TestClient(create_app()):
        pass


KV_REF = "@Microsoft.KeyVault(VaultName=kv-kanban-newbothi;SecretName=ml-token)"


def test_s13_no_arranca_con_referencia_de_key_vault_sin_resolver(monkeypatch):
    monkeypatch.setenv("ML_ENV", "production")
    monkeypatch.setenv("ML_TOKEN", KV_REF)
    assert len(KV_REF) > 32  # pasaría el control de longitud
    with pytest.raises(RuntimeError, match="Key Vault no resolvió: ML_TOKEN"), TestClient(create_app()):
        pass


def test_s13_la_referencia_se_rechaza_tambien_fuera_de_produccion(monkeypatch):
    monkeypatch.delenv("ML_ENV", raising=False)
    monkeypatch.setenv("ML_TOKEN", "  @microsoft.keyvault(SecretUri=https://x.vault.azure.net/secrets/y)")
    with pytest.raises(RuntimeError, match="ML_TOKEN"), TestClient(create_app()):
        pass


def test_s13_lista_solo_nombres_ordenados():
    env = {"ML_TOKEN": KV_REF, "OTRA": KV_REF, "ML_ENV": "production", "BIEN": TOKEN}
    assert unresolved_key_vault_references(env) == ["ML_TOKEN", "OTRA"]


def test_s06_produccion_exige_el_token(prod_env):
    with TestClient(create_app()) as client:
        assert client.post("/analyze", json=payload()).status_code == 401
        ok = client.post("/analyze", json=payload(), headers={"X-ML-Token": TOKEN})
        assert ok.status_code == 200


# ---------- S-07: sin documentación pública en producción ----------

def test_s07_produccion_oculta_docs_y_esquema(prod_env):
    with TestClient(create_app()) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 404, path
        assert client.get("/health").status_code == 200


def test_s07_desarrollo_mantiene_docs(monkeypatch):
    monkeypatch.delenv("ML_ENV", raising=False)
    with TestClient(create_app()) as client:
        assert client.get("/openapi.json").status_code == 200


# ---------- S-22: entradas raras no producen 500 ----------

def test_s22_token_no_ascii_es_401_y_no_500(prod_env):
    with TestClient(create_app()) as client:
        r = client.post("/analyze", json=payload(), headers={"X-ML-Token": "é".encode("latin-1")})
        assert r.status_code == 401


def test_s22_fechas_sin_zona_horaria_son_422(prod_env):
    data = payload()
    data["cards"][0]["createdAt"] = "2026-10-01T10:00:00"  # sin zona
    with TestClient(create_app()) as client:
        r = client.post("/analyze", json=data, headers={"X-ML-Token": TOKEN})
        assert r.status_code == 422


def test_s22_now_fuera_de_rango_es_422(prod_env):
    with TestClient(create_app()) as client:
        r = client.post("/analyze", json=payload(now="9999-12-31T00:00:00Z"), headers={"X-ML-Token": TOKEN})
        assert r.status_code == 422


# ---------- S-05: topes de tamaño, memoria y tiempo ----------

def test_s05_rechaza_mas_tarjetas_que_el_tope(prod_env):
    card = {"id": "x", "title": "t", "columnId": "todo", "createdAt": NOW.isoformat()}
    with TestClient(create_app()) as client:
        r = client.post("/analyze", json=payload(cards=[card] * (MAX_CARDS + 1)), headers={"X-ML-Token": TOKEN})
        assert r.status_code == 422


def test_s05_rechaza_simulaciones_sobre_el_tope(prod_env):
    with TestClient(create_app()) as client:
        r = client.post("/analyze", json=payload(simulations=MAX_SIMULATIONS + 1), headers={"X-ML-Token": TOKEN})
        assert r.status_code == 422


def test_s05_rechaza_cuerpos_de_mas_de_10_mb(prod_env):
    with TestClient(create_app()) as client:
        r = client.post(
            "/analyze",
            content=b"x" * (11 * 1024 * 1024),
            headers={"X-ML-Token": TOKEN, "content-type": "application/json"},
        )
        assert r.status_code == 413


def test_s05_monte_carlo_usa_memoria_acotada():
    # Antes: ~180 MB con 20.000 simulaciones (y ~600 MB con 50.000).
    tracemalloc.start()
    try:
        forecast.simulate([3, 5, 4, 6, 2, 5, 4, 3, 5, 6, 4, 5], 400, NOW, MAX_SIMULATIONS)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < 60 * 1024 * 1024


def test_s05_monte_carlo_sigue_llegando_al_horizonte():
    # Un ritmo de casi cero: muchas simulaciones no terminan nunca y quedan en el horizonte máximo.
    fc = forecast.simulate([0] * 11 + [1], remaining=500, now=NOW, simulations=1000)
    assert fc is not None and fc.p95.weeks == forecast.MAX_HORIZON


def test_s05_analisis_de_5000_tarjetas_en_menos_de_2_segundos():
    # Antes: ~16 s (wip_at era O(N²)).
    req = steady_board(per_week=190, weeks=26, pending=60).request(simulations=10_000)
    assert len(req.cards) == MAX_CARDS
    t = time.perf_counter()
    analyze(req)
    assert time.perf_counter() - t < 2.0


def _wip_ingenuo(board, t):
    """La implementación anterior, como referencia."""
    n = 0
    for c in board.cards:
        for s in c.stays:
            if s.column_id in board.middle_cols and s.start <= t and (s.end is None or t < s.end):
                n += 1
                break
    return n


def test_s05_wip_rapido_da_lo_mismo_que_el_ingenuo():
    rng = random.Random(7)
    b = BoardBuilder()
    for i in range(300):
        created = NOW - timedelta(days=rng.uniform(1, 120))
        started = created + timedelta(days=rng.uniform(0, 10)) if rng.random() < 0.8 else None
        done = started + timedelta(days=rng.uniform(0, 15)) if started and rng.random() < 0.7 else None
        b.card(f"Bug: {i}", created, started, done)
    board = build(AnalyzeRequest.model_validate({
        "now": NOW.isoformat(), "columns": COLUMNS, "cards": b.cards, "events": b.events,
    }))
    instantes = [NOW - timedelta(days=rng.uniform(0, 130)) for _ in range(500)]
    instantes += [s.start for c in board.cards for s in c.stays]  # justo en los bordes
    instantes += [s.end for c in board.cards for s in c.stays if s.end]
    for t in instantes:
        assert wip_at(board, t) == _wip_ingenuo(board, t)
