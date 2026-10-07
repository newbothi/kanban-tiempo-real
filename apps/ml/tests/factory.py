"""Construye tableros sintéticos con propiedades CONOCIDAS para verificar los análisis."""
from datetime import datetime, timedelta, timezone

import numpy as np

from app.schemas import AnalyzeRequest

NOW = datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)
COLUMNS = [
    {"id": "todo", "title": "Por hacer", "position": "a0"},
    {"id": "doing", "title": "En progreso", "position": "a1"},
    {"id": "done", "title": "Hecho", "position": "a2"},
]


class BoardBuilder:
    def __init__(self) -> None:
        self.cards: list[dict] = []
        self.events: list[dict] = []

    def card(self, title: str, created: datetime, started: datetime | None = None,
             done: datetime | None = None) -> str:
        cid = f"c{len(self.cards)}"
        col = "done" if done else ("doing" if started else "todo")
        self.cards.append({"id": cid, "title": title, "columnId": col, "createdAt": created.isoformat()})
        self.events.append({"cardId": cid, "type": "created", "toColumnId": "todo", "at": created.isoformat()})
        if started:
            self.events.append({"cardId": cid, "type": "moved", "fromColumnId": "todo",
                                "toColumnId": "doing", "at": started.isoformat()})
        if done:
            self.events.append({"cardId": cid, "type": "moved", "fromColumnId": "doing",
                                "toColumnId": "done", "at": done.isoformat()})
        return cid

    def request(self, simulations: int = 2000) -> AnalyzeRequest:
        return AnalyzeRequest.model_validate({
            "now": NOW.isoformat(), "columns": COLUMNS, "cards": self.cards,
            "events": self.events, "simulations": simulations,
        })


def steady_board(per_week: int = 5, weeks: int = 12, pending: int = 0) -> BoardBuilder:
    """Exactamente `per_week` tarjetas terminadas por semana (ventanas que terminan en NOW)."""
    b = BoardBuilder()
    for w in range(weeks):
        week_start = NOW - timedelta(days=7 * (w + 1))
        for i in range(per_week):
            done = week_start + timedelta(days=1 + i * 0.5)
            b.card(f"Bug: tarea {w}-{i}", done - timedelta(days=3), done - timedelta(days=1), done)
    for i in range(pending):
        b.card(f"Feature: pendiente {i}", NOW - timedelta(days=1))
    return b


def wip_effect_board(n: int = 80, days_per_wip: float = 1.0, seed: int = 1) -> BoardBuilder:
    """La duración depende del WIP al empezar: duración = 1 + days_per_wip·WIP (+ ruido)."""
    rng = np.random.default_rng(seed)
    b = BoardBuilder()
    busy: list[tuple[datetime, datetime]] = []
    t = NOW - timedelta(days=n * 1.25 + 5)  # la actividad llega hasta hoy
    for i in range(n):
        t += timedelta(days=float(rng.uniform(0.5, 2.0)))
        start = t + timedelta(hours=2)
        wip = sum(1 for s, e in busy if s <= start < e)
        duration = 1 + days_per_wip * wip + float(rng.normal(0, 0.3))
        done = start + timedelta(days=max(duration, 0.2))
        if done > NOW:
            b.card(f"Feature: tarea {i}", t, start)
        else:
            b.card(f"Feature: tarea {i}", t, start, done)
        busy.append((start, done))
    return b
