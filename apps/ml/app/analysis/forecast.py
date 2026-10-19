"""Pronóstico de entrega por simulación Monte Carlo (método estándar en Kanban).

En vez de suponer un ritmo promedio fijo, se simulan miles de futuros posibles
sacando al azar semanas reales del historial reciente. La fecha p85 significa:
"en el 85% de los futuros simulados, el trabajo pendiente ya estaba terminado".
"""
from collections import Counter
from datetime import datetime, timedelta

import numpy as np

from app.schemas import Forecast, ForecastPoint, HistogramBin

HISTORY_WEEKS = 12
MIN_WEEKS = 4
MAX_HORIZON = 520  # 10 años: si no alcanza, el ritmo es prácticamente cero
BLOCK_WEEKS = 26  # se simula por bloques de medio año y se para cuando todas terminaron


def simulate(counts: list[int], remaining: int, now: datetime, simulations: int, seed: int = 42) -> Forecast | None:
    history = counts[-HISTORY_WEEKS:]
    if len(history) < MIN_WEEKS or remaining <= 0 or sum(history) == 0:
        return None

    rng = np.random.default_rng(seed)
    hist = np.array(history, dtype=np.int32)
    # Antes se generaba la matriz completa (simulaciones × 520 semanas, int64): con 50.000
    # simulaciones eran ~600 MB. Por bloques y en int32, la memoria queda acotada y casi
    # siempre basta el primer bloque.
    weeks = np.full(simulations, MAX_HORIZON, dtype=np.int32)
    finished = np.zeros(simulations, dtype=bool)
    total = np.zeros(simulations, dtype=np.int64)
    for start in range(0, MAX_HORIZON, BLOCK_WEEKS):
        block = rng.choice(hist, size=(simulations, BLOCK_WEEKS), replace=True)
        cumulative = total[:, None] + block.cumsum(axis=1, dtype=np.int64)
        reached = cumulative >= remaining
        newly = ~finished & reached.any(axis=1)
        weeks[newly] = start + reached[newly].argmax(axis=1) + 1
        finished |= newly
        total = cumulative[:, -1]
        if finished.all():
            break

    def point(q: float) -> ForecastPoint:
        w = int(np.ceil(np.percentile(weeks, q)))
        return ForecastPoint(weeks=w, date=now + timedelta(weeks=w))

    freq = Counter(weeks.tolist())
    histogram = [HistogramBin(weeks=w, probability=n / simulations) for w, n in sorted(freq.items())]

    return Forecast(
        remaining=remaining,
        simulations=simulations,
        weeks_of_history=len(history),
        p50=point(50),
        p85=point(85),
        p95=point(95),
        histogram=histogram,
    )
