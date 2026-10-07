from fastapi.testclient import TestClient

from app.main import app
from tests.factory import COLUMNS, NOW, steady_board

client = TestClient(app)


def payload(**overrides):
    req = steady_board(per_week=4, weeks=8, pending=5).request()
    data = req.model_dump(mode="json", by_alias=True)
    data.update(overrides)
    return data


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_respuesta_en_camel_case():
    r = client.post("/analyze", json=payload())
    assert r.status_code == 200
    body = r.json()
    assert {"summary", "throughput", "trend", "forecast", "cycleTime", "stale", "insights", "warnings"} <= body.keys()
    assert "doneLast4Weeks" in body["summary"]
    assert "weekStart" in body["throughput"][0]


def test_valida_la_entrada():
    assert client.post("/analyze", json=payload(simulations=10)).status_code == 422
    assert client.post("/analyze", json={"now": NOW.isoformat()}).status_code == 422


def test_tablero_con_una_columna_es_422():
    assert client.post("/analyze", json=payload(columns=COLUMNS[:1])).status_code == 422


def test_token_obligatorio_si_esta_configurado(monkeypatch):
    monkeypatch.setenv("ML_TOKEN", "secreto")
    assert client.post("/analyze", json=payload()).status_code == 401
    assert client.post("/analyze", json=payload(), headers={"X-ML-Token": "otro"}).status_code == 401
    assert client.post("/analyze", json=payload(), headers={"X-ML-Token": "secreto"}).status_code == 200
