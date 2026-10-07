"""Orquesta los análisis y redacta las conclusiones en español."""
from datetime import timedelta

import numpy as np

from app.analysis import cycle_time, forecast, stale, throughput, trend
from app.analysis.timeline import build, days_between
from app.schemas import AnalyzeRequest, AnalyzeResponse, Summary, WeekPoint

MODEL_NAMES = {
    "baseline_median": "la mediana (ningún modelo la superó)",
    "linear_regression": "regresión lineal",
    "gradient_boosting": "gradient boosting",
}
KIND_NAMES = {"bug": "los bugs", "feature": "las features", "docs": "la documentación",
              "refactor": "los refactors", "otro": "las demás tareas"}


def fmt(x: float, decimals: int = 1) -> str:
    """Número con coma decimal (formato chileno)."""
    return f"{x:.{decimals}f}".replace(".", ",")


def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    warnings: list[str] = []
    insights: list[str] = []
    now = req.now

    if len(req.columns) < 2:
        raise ValueError("El tablero necesita al menos 2 columnas")

    board = build(req)
    done_cards = [c for c in board.cards if c.done_at]
    lead_times = [days_between(c.created, c.done_at) for c in done_cards]

    summary = Summary(
        cards_total=len(board.cards),
        backlog=sum(c.column_id == board.first_col for c in board.cards),
        in_progress=sum(c.column_id in board.middle_cols for c in board.cards),
        done=len(done_cards),
        done_last_4_weeks=sum(c.done_at >= now - timedelta(weeks=4) for c in done_cards),
        lead_time_median_days=round(float(np.median(lead_times)), 2) if lead_times else None,
        lead_time_p85_days=round(float(np.percentile(lead_times, 85)), 2) if lead_times else None,
    )

    # Throughput + tendencia
    weeks = throughput.weekly(board, now)
    counts = [n for _, n in weeks]
    fitted = trend.fit(counts)
    trend_result = fitted[0] if fitted else None
    line = fitted[1] if fitted else [None] * len(weeks)
    points = [WeekPoint(week_start=s, done=n, trend=t) for (s, n), t in zip(weeks, line)]

    if trend_result is None:
        warnings.append(f"Se necesitan al menos {trend.MIN_WEEKS} semanas con actividad para calcular la tendencia.")
    elif trend_result.direction == "flat":
        insights.append(
            f"El ritmo del equipo es estable: la pendiente ({fmt(trend_result.slope_per_week, 2)} tarjetas/semana "
            f"por semana) no es estadísticamente significativa (p = {fmt(trend_result.p_value, 2)})."
        )
    else:
        verbo = "acelerando" if trend_result.direction == "up" else "desacelerando"
        insights.append(
            f"El equipo va {verbo}: cada semana termina en promedio {fmt(abs(trend_result.slope_per_week), 2)} "
            f"tarjetas {'más' if trend_result.direction == 'up' else 'menos'} que la anterior "
            f"(p = {fmt(trend_result.p_value, 3)}, R² = {fmt(trend_result.r2, 2)})."
        )

    # Monte Carlo
    remaining = summary.backlog + summary.in_progress
    fc = forecast.simulate(counts, remaining, now, req.simulations)
    if fc is None and remaining > 0:
        warnings.append("No hay suficiente historial de tarjetas terminadas para pronosticar la fecha de entrega.")
    elif fc:
        # Sin fecha en el texto: la UI la muestra en la zona horaria del usuario.
        insights.append(
            f"Con el ritmo de las últimas {fc.weeks_of_history} semanas, hay un 85% de probabilidad de terminar las "
            f"{remaining} tarjetas pendientes en {fc.p85.weeks} semanas o menos."
        )

    # Predicción de tiempo de entrega
    ct = cycle_time.train_and_predict(board, now)
    if ct is None:
        warnings.append(
            f"Se necesitan al menos {cycle_time.MIN_TRAIN} tarjetas terminadas para entrenar el modelo de "
            f"predicción (hay {len(done_cards)})."
        )
    else:
        best = next(s for s in ct.scores if s.name == ct.best_model)
        base = next(s for s in ct.scores if s.name == "baseline_median")
        mejora = (1 - best.mae_days / base.mae_days) * 100 if base.mae_days else 0
        insights.append(
            f"El mejor modelo para predecir cuánto tarda una tarjeta es {MODEL_NAMES[ct.best_model]}: se equivoca en "
            f"promedio {fmt(best.mae_days)} días ({fmt(mejora, 0)}% mejor que usar siempre la mediana)."
        )
        if ct.wip_effect_days > 0.05:
            insights.append(
                f"Cada tarjeta adicional en progreso al empezar una tarea la retrasa ~{fmt(ct.wip_effect_days)} días: "
                f"limitar el trabajo en paralelo acelera las entregas."
            )
        if ct.kind_effect_days:
            slowest = max(ct.kind_effect_days, key=ct.kind_effect_days.get)
            fastest = min(ct.kind_effect_days, key=ct.kind_effect_days.get)
            if slowest != fastest:
                insights.append(
                    f"{KIND_NAMES.get(slowest, slowest).capitalize()} son lo que más tarda y "
                    f"{KIND_NAMES.get(fastest, fastest)} lo más rápido "
                    f"(diferencia de ~{fmt(ct.kind_effect_days[slowest] - ct.kind_effect_days[fastest])} días)."
                )

    stale_cards = stale.detect(board, now)
    if stale_cards:
        insights.append(
            f"{len(stale_cards)} tarjeta{'s' if len(stale_cards) != 1 else ''} "
            f"lleva{'n' if len(stale_cards) != 1 else ''} mucho más tiempo de lo normal en su columna."
        )

    return AnalyzeResponse(
        generated_at=now,
        summary=summary,
        throughput=points,
        trend=trend_result,
        forecast=fc,
        cycle_time=ct,
        stale=stale_cards,
        insights=insights,
        warnings=warnings,
    )
