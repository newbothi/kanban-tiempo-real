"""Throughput semanal: cuántas tarjetas se terminan en cada ventana de 7 días."""
from datetime import datetime, timedelta

from app.analysis.timeline import Board

MAX_WEEKS = 26


def weekly(board: Board, now: datetime) -> list[tuple[datetime, int]]:
    """Ventanas de 7 días que terminan en `now` (así no hay semana parcial).

    Devuelve [(inicio_de_semana, terminadas)] de la más antigua a la más reciente,
    desde la primera actividad del tablero (máximo 26 semanas).
    """
    if not board.cards:
        return []
    first = min(c.created for c in board.cards)
    n_weeks = min(MAX_WEEKS, max(1, int((now - first).total_seconds() // (7 * 86_400)) + 1))
    starts = [now - timedelta(days=7 * (i + 1)) for i in reversed(range(n_weeks))]
    counts = [0] * n_weeks
    for c in board.cards:
        if c.done_at is None:
            continue
        for i, s in enumerate(starts):
            if s <= c.done_at < s + timedelta(days=7):
                counts[i] += 1
                break
    return list(zip(starts, counts))
