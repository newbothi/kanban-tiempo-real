"""Reconstruye la historia de cada tarjeta a partir de los eventos."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from app.schemas import AnalyzeRequest

DAY = 86_400.0


def days_between(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / DAY


@dataclass
class Stay:
    column_id: str
    start: datetime
    end: datetime | None  # None = sigue ahí


@dataclass
class CardTimeline:
    id: str
    title: str
    created: datetime
    column_id: str  # columna actual
    stays: list[Stay] = field(default_factory=list)
    started: datetime | None = None  # primera vez que salió de la primera columna
    done_at: datetime | None = None  # llegada a la última columna (si sigue ahí)


@dataclass
class Board:
    first_col: str
    done_col: str
    middle_cols: set[str]
    cards: list[CardTimeline]


def build(req: AnalyzeRequest) -> Board:
    cols = sorted(req.columns, key=lambda c: c.position)
    first_col, done_col = cols[0].id, cols[-1].id
    middle = {c.id for c in cols[1:-1]}

    by_card: dict[str, list] = {}
    for ev in sorted(req.events, key=lambda e: e.at):
        by_card.setdefault(ev.card_id, []).append(ev)

    cards: list[CardTimeline] = []
    for c in req.cards:
        tl = CardTimeline(id=c.id, title=c.title, created=c.created_at, column_id=c.column_id)
        entries: list[tuple[str, datetime]] = []
        for ev in by_card.get(c.id, []):
            if ev.type in ("created", "moved") and ev.to_column_id:
                entries.append((ev.to_column_id, ev.at))
        if not entries:  # tarjeta sin historial (p. ej. anterior al registro de eventos)
            entries = [(c.column_id, c.created_at)]
        for i, (col, at) in enumerate(entries):
            end = entries[i + 1][1] if i + 1 < len(entries) else None
            tl.stays.append(Stay(col, at, end))
        tl.started = next((at for col, at in entries if col != first_col), None)
        if c.column_id == done_col:
            tl.done_at = entries[-1][1]
        cards.append(tl)

    return Board(first_col, done_col, middle, cards)


def wip_at(board: Board, t: datetime) -> int:
    """Tarjetas que estaban en columnas intermedias en el instante t."""
    n = 0
    for c in board.cards:
        for s in c.stays:
            if s.column_id in board.middle_cols and s.start <= t and (s.end is None or t < s.end):
                n += 1
                break
    return n
