"""Tarjetas estancadas: llevan en su columna mucho más de lo habitual.

Solo se revisan las columnas de trabajo en curso: esperar en el backlog es estar
en cola, no estar estancado.

Para cada columna se mira cuánto duraron históricamente las tarjetas ahí y se usa
la regla del rango intercuartil (Q3 + 1,5·IQR), la misma que define los "outliers"
en un diagrama de caja. Es simple, robusta a valores extremos y fácil de explicar.
"""
from datetime import datetime

import numpy as np

from app.analysis.timeline import Board, days_between
from app.schemas import StaleCard

MIN_SAMPLES = 8
MIN_THRESHOLD_DAYS = 1.0


def detect(board: Board, now: datetime) -> list[StaleCard]:
    history: dict[str, list[float]] = {}
    for c in board.cards:
        for s in c.stays:
            if s.end is not None:
                history.setdefault(s.column_id, []).append(days_between(s.start, s.end))

    result = []
    for c in board.cards:
        if c.column_id not in board.middle_cols or not c.stays:
            continue
        current = c.stays[-1]
        if current.end is not None or current.column_id != c.column_id:
            continue
        samples = history.get(c.column_id, [])
        if len(samples) < MIN_SAMPLES:
            continue
        q1, median, q3 = np.percentile(samples, [25, 50, 75])
        threshold = max(q3 + 1.5 * (q3 - q1), MIN_THRESHOLD_DAYS)
        days = days_between(current.start, now)
        if days > threshold:
            result.append(
                StaleCard(
                    card_id=c.id,
                    column_id=c.column_id,
                    days_in_column=round(days, 2),
                    typical_days=round(float(median), 2),
                    threshold_days=round(float(threshold), 2),
                )
            )
    return sorted(result, key=lambda s: s.days_in_column / max(s.typical_days, 0.1), reverse=True)
