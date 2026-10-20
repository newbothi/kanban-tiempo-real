"""Tests de propiedades (Hypothesis): invariantes que deben cumplirse con CUALQUIER tablero.

Los tests de test_analysis.py usan tableros con propiedades conocidas; estos generan
tableros y series al azar y revisan que el análisis nunca diga algo imposible.
"""
from datetime import timedelta

import numpy as np
from hypothesis import assume, given
from hypothesis import strategies as st

from app.analysis import forecast, trend
from app.analysis.throughput import MAX_WEEKS, weekly
from app.analysis.timeline import build
from app.schemas import AnalyzeResponse
from app.service import analyze
from tests.factory import NOW, BoardBuilder

counts_st = st.lists(st.integers(min_value=0, max_value=40), min_size=4, max_size=26)


# ---------- Monte Carlo ----------

@given(counts=counts_st, remaining=st.integers(min_value=1, max_value=300))
def test_percentiles_ordenados_e_histograma_es_una_distribucion(counts, remaining):
    fc = forecast.simulate(counts, remaining, NOW, simulations=500)
    if sum(counts[-forecast.HISTORY_WEEKS:]) == 0:
        assert fc is None  # sin entregas no se puede pronosticar
        return
    assert fc is not None
    assert 1 <= fc.p50.weeks <= fc.p85.weeks <= fc.p95.weeks <= forecast.MAX_HORIZON
    assert fc.p85.date == NOW + timedelta(weeks=fc.p85.weeks)
    probs = [b.probability for b in fc.histogram]
    assert all(p > 0 for p in probs)
    assert abs(sum(probs) - 1) < 1e-9
    assert [b.weeks for b in fc.histogram] == sorted({b.weeks for b in fc.histogram})


@given(counts=counts_st, remaining=st.integers(min_value=1, max_value=300), extra=st.integers(1, 10))
def test_mas_ritmo_nunca_atrasa_la_fecha(counts, remaining, extra):
    assume(sum(counts[-forecast.HISTORY_WEEKS:]) > 0)
    lento = forecast.simulate(counts, remaining, NOW, simulations=500, seed=7)
    rapido = forecast.simulate([c + extra for c in counts], remaining, NOW, simulations=500, seed=7)
    assert lento is not None and rapido is not None
    assert rapido.p50.weeks <= lento.p50.weeks
    assert rapido.p85.weeks <= lento.p85.weeks
    assert rapido.p95.weeks <= lento.p95.weeks


@given(counts=counts_st, remaining=st.integers(min_value=1, max_value=300))
def test_mas_trabajo_pendiente_nunca_adelanta_la_fecha(counts, remaining):
    assume(sum(counts[-forecast.HISTORY_WEEKS:]) > 0)
    poco = forecast.simulate(counts, remaining, NOW, simulations=500, seed=3)
    mucho = forecast.simulate(counts, remaining + 25, NOW, simulations=500, seed=3)
    assert poco is not None and mucho is not None
    assert mucho.p85.weeks >= poco.p85.weeks


@given(counts=counts_st, remaining=st.integers(min_value=1, max_value=100))
def test_misma_semilla_mismo_resultado(counts, remaining):
    a = forecast.simulate(counts, remaining, NOW, simulations=300, seed=11)
    b = forecast.simulate(counts, remaining, NOW, simulations=300, seed=11)
    assert a == b


# ---------- Tendencia (regresión lineal) ----------

@given(counts=counts_st)
def test_tendencia_coherente(counts):
    out = trend.fit(counts)
    if len(set(counts)) == 1:
        assert out is None  # serie constante: no hay pendiente que estimar
        return
    assert out is not None
    t, line = out
    assert len(line) == len(counts)
    assert 0 <= t.r2 <= 1 + 1e-9
    assert 0 <= t.p_value <= 1
    lo, hi = t.slope_ci95
    assert lo <= t.slope_per_week <= hi
    if t.direction == "flat":
        assert t.p_value >= 0.05
    else:
        assert t.p_value < 0.05
        assert (t.direction == "up") == (t.slope_per_week > 0)


@given(counts=counts_st, shift=st.integers(1, 50))
def test_sumar_una_constante_no_cambia_la_pendiente(counts, shift):
    assume(len(set(counts)) > 1)
    a, _ = trend.fit(counts)
    b, _ = trend.fit([c + shift for c in counts])
    assert np.isclose(a.slope_per_week, b.slope_per_week)
    assert np.isclose(b.intercept, a.intercept + shift)


# ---------- Tableros al azar, análisis completo ----------

KINDS = ["Bug: ", "Feature: ", "Docs: ", "Refactor: ", ""]


@st.composite
def boards(draw):
    """Tarjetas con fechas al azar: unas en cola, otras en curso y otras terminadas."""
    b = BoardBuilder()
    n = draw(st.integers(min_value=0, max_value=60))
    for i in range(n):
        created = NOW - timedelta(hours=draw(st.integers(min_value=1, max_value=24 * 200)))
        hasta_hoy = (NOW - created).total_seconds() / 3600
        started = done = None
        if draw(st.booleans()):
            started = created + timedelta(hours=draw(st.floats(0, hasta_hoy * 0.9)))
            if draw(st.booleans()):
                done = started + timedelta(hours=draw(st.floats(0, (NOW - started).total_seconds() / 3600)))
        b.card(f"{draw(st.sampled_from(KINDS))}tarjeta {i}", created, started, done)
    return b


@given(b=boards())
def test_el_analisis_nunca_dice_algo_imposible(b):
    req = b.request(simulations=1000)
    res = analyze(req)
    s = res.summary
    assert s.cards_total == len(req.cards)
    assert s.backlog + s.in_progress + s.done == s.cards_total
    assert 0 <= s.done_last_4_weeks <= s.done
    if s.lead_time_median_days is not None:
        assert 0 <= s.lead_time_median_days <= s.lead_time_p85_days

    # Throughput: no más entregas que tarjetas terminadas, y nunca negativo.
    assert len(res.throughput) <= MAX_WEEKS
    assert all(p.done >= 0 for p in res.throughput)
    assert sum(p.done for p in res.throughput) <= s.done

    # Predicciones y tarjetas estancadas solo para lo que NO está terminado.
    terminadas = {c["id"] for c in b.cards if c["columnId"] == "done"}
    assert not terminadas & {p.card_id for p in (res.cycle_time.predictions if res.cycle_time else [])}
    assert not terminadas & {st_.card_id for st_ in res.stale}
    for st_ in res.stale:
        assert st_.column_id == "doing"  # solo columnas intermedias
        assert st_.days_in_column > st_.threshold_days

    if res.cycle_time:
        for p in res.cycle_time.predictions:
            assert p.remaining_days >= 0
            assert p.overdue == (p.elapsed_days > p.predicted_lead_time_days) or p.remaining_days == 0

    # La respuesta siempre se puede serializar y volver a leer (el contrato con Node).
    AnalyzeResponse.model_validate_json(res.model_dump_json(by_alias=True))


@given(b=boards())
def test_throughput_cuenta_cada_entrega_reciente_una_sola_vez(b):
    req = b.request()
    board = build(req)
    weeks = weekly(board, NOW)
    if not board.cards:
        assert weeks == []
        return
    inicio = weeks[0][0]
    esperadas = sum(1 for c in board.cards if c.done_at is not None and c.done_at > inicio)
    assert sum(n for _, n in weeks) == esperadas
    # Las semanas son ventanas contiguas de 7 días que terminan en NOW.
    assert weeks[-1][0] + timedelta(days=7) == NOW
    assert all(b2[0] - a[0] == timedelta(days=7) for a, b2 in zip(weeks, weeks[1:], strict=False))


def test_una_entrega_justo_en_now_cuenta_en_la_ultima_semana():
    """Regresión del caso que encontró Hypothesis."""
    b = BoardBuilder()
    t = NOW - timedelta(hours=1)
    b.card("Bug: al límite", t, t, NOW)
    weeks = weekly(build(b.request()), NOW)
    assert weeks[-1][1] == 1
