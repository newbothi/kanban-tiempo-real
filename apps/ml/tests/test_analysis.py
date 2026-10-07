from datetime import timedelta

import pytest

from app.analysis import cycle_time, forecast, stale, throughput, trend
from app.analysis.timeline import build, wip_at
from app.service import analyze
from tests.factory import NOW, BoardBuilder, steady_board, wip_effect_board


def test_timeline_reconstruye_estadias_y_fechas():
    b = BoardBuilder()
    created, started, done = NOW - timedelta(days=5), NOW - timedelta(days=3), NOW - timedelta(days=1)
    b.card("Bug: algo", created, started, done)
    board = build(b.request())
    card = board.cards[0]
    assert [s.column_id for s in card.stays] == ["todo", "doing", "done"]
    assert card.started == started and card.done_at == done
    assert card.stays[-1].end is None


def test_wip_cuenta_solo_columnas_intermedias():
    b = BoardBuilder()
    b.card("a", NOW - timedelta(days=10), NOW - timedelta(days=5))             # sigue en progreso
    b.card("b", NOW - timedelta(days=10), NOW - timedelta(days=9), NOW - timedelta(days=8))  # ya terminó
    b.card("c", NOW - timedelta(days=1))                                       # en backlog
    board = build(b.request())
    assert wip_at(board, NOW) == 1
    assert wip_at(board, NOW - timedelta(days=8.5)) == 1  # "b" estaba en progreso


def test_throughput_semanal_exacto():
    board = build(steady_board(per_week=5, weeks=8).request())
    counts = [n for _, n in throughput.weekly(board, NOW)]
    assert counts[-8:] == [5] * 8


@pytest.mark.parametrize(
    "counts,expected",
    [
        ([1, 2, 3, 4, 5, 6, 7, 8], "up"),
        ([8, 7, 6, 5, 4, 3, 2, 1], "down"),
        ([5, 4, 6, 5, 4, 6, 5, 5], "flat"),
    ],
)
def test_tendencia_detecta_direccion(counts, expected):
    result, fitted = trend.fit(counts)
    assert result.direction == expected
    assert len(fitted) == len(counts)


def test_tendencia_perfecta_tiene_r2_1():
    result, _ = trend.fit([2, 4, 6, 8, 10])
    assert result.slope_per_week == pytest.approx(2)
    assert result.r2 == pytest.approx(1)


def test_tendencia_sin_datos_suficientes():
    assert trend.fit([3, 4, 5]) is None
    assert trend.fit([4, 4, 4, 4, 4]) is None  # sin variación no hay recta que ajustar


def test_monte_carlo_con_ritmo_constante_es_exacto():
    fc = forecast.simulate([5] * 12, remaining=20, now=NOW, simulations=2000)
    assert (fc.p50.weeks, fc.p85.weeks, fc.p95.weeks) == (4, 4, 4)
    assert fc.p85.date == NOW + timedelta(weeks=4)
    assert sum(b.probability for b in fc.histogram) == pytest.approx(1)


def test_monte_carlo_percentiles_ordenados_y_reproducibles():
    counts = [0, 3, 8, 2, 5, 7, 1, 6, 4, 9, 2, 5]
    a = forecast.simulate(counts, 40, NOW, 5000)
    b = forecast.simulate(counts, 40, NOW, 5000)
    assert a.p50.weeks <= a.p85.weeks <= a.p95.weeks
    assert a == b  # misma semilla → mismo resultado


def test_monte_carlo_sin_ritmo():
    assert forecast.simulate([0] * 10, 5, NOW, 2000) is None
    assert forecast.simulate([5] * 10, 0, NOW, 2000) is None


def test_modelo_descubre_el_efecto_del_wip():
    board = build(wip_effect_board(n=90, days_per_wip=1.0).request())
    ct = cycle_time.train_and_predict(board, NOW)
    assert ct is not None
    # La relación real es +1 día por tarjeta en curso: el coeficiente lineal debe acercarse.
    assert ct.wip_effect_days == pytest.approx(1.0, abs=0.25)
    best = min(ct.scores, key=lambda s: s.mae_days)
    baseline = next(s for s in ct.scores if s.name == "baseline_median")
    assert best.name != "baseline_median"
    assert best.mae_days < baseline.mae_days * 0.6


def test_modelo_necesita_datos_minimos():
    board = build(steady_board(per_week=1, weeks=10).request())
    assert cycle_time.train_and_predict(board, NOW) is None


def test_predicciones_marcan_tarjetas_atrasadas():
    b = steady_board(per_week=3, weeks=8)  # tarjetas que tardan 3 días
    b.card("Bug: antigua", NOW - timedelta(days=30), NOW - timedelta(days=29))
    ct = cycle_time.train_and_predict(build(b.request()), NOW)
    pred = next(p for p in ct.predictions if p.elapsed_days > 29)
    assert pred.overdue and pred.remaining_days == 0


def test_detecta_tarjeta_estancada():
    b = steady_board(per_week=3, weeks=6)  # en progreso suelen estar ~2 días
    stuck = b.card("Bug: bloqueada", NOW - timedelta(days=20), NOW - timedelta(days=15))
    normal = b.card("Bug: normal", NOW - timedelta(days=2), NOW - timedelta(days=1))
    result = stale.detect(build(b.request()), NOW)
    ids = [s.card_id for s in result]
    assert stuck in ids and normal not in ids
    assert result[0].days_in_column == pytest.approx(15, abs=0.01)


def test_el_backlog_no_cuenta_como_estancado():
    b = steady_board(per_week=3, weeks=6)
    waiting = b.card("Feature: en cola hace mucho", NOW - timedelta(days=60))  # nunca empezó
    assert waiting not in [s.card_id for s in stale.detect(build(b.request()), NOW)]


def test_analisis_completo_genera_conclusiones():
    b = wip_effect_board(n=90)
    for i in range(6):
        b.card(f"Docs: pendiente {i}", NOW - timedelta(days=1))
    res = analyze(b.request())
    assert res.summary.backlog == 6
    assert res.forecast is not None and res.cycle_time is not None
    assert any("85%" in s for s in res.insights)
    assert any("progreso" in s for s in res.insights)


def test_tablero_vacio_no_falla():
    res = analyze(BoardBuilder().request())
    assert res.summary.cards_total == 0
    assert res.trend is None and res.forecast is None and res.cycle_time is None
    assert res.warnings
