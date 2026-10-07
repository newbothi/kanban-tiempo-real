"""Predicción del tiempo de entrega (lead time) de cada tarjeta.

Variables (features):
- tipo de tarea, según el prefijo del título ("Bug: ...", "Feature: ...")
- largo del título en palabras
- trabajo en curso (WIP) al momento de empezarla: con más tarjetas en paralelo,
  cada una tarda más (ley de Little)

Se comparan tres modelos con validación cruzada y se usa el de menor error:
- baseline: siempre predice la mediana (el mínimo que un modelo debe superar)
- regresión lineal: interpretable (cuántos días agrega cada factor)
- gradient boosting: captura relaciones no lineales
"""
from datetime import datetime

import numpy as np
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import KFold, cross_val_score

from app.analysis.timeline import Board, CardTimeline, days_between, wip_at
from app.schemas import CardPrediction, CycleTime, ModelScore

MIN_TRAIN = 15
KNOWN_KINDS = ["bug", "feature", "docs", "refactor"]


def kind_of(title: str) -> str:
    prefix = title.split(":", 1)[0].strip().lower() if ":" in title else ""
    return prefix if prefix in KNOWN_KINDS else "otro"


def features(card: CardTimeline, wip: int, kinds: list[str]) -> list[float]:
    k = kind_of(card.title)
    return [float(wip), float(len(card.title.split()))] + [1.0 if k == kk else 0.0 for kk in kinds]


def train_and_predict(board: Board, now: datetime) -> CycleTime | None:
    done = [c for c in board.cards if c.done_at is not None]
    if len(done) < MIN_TRAIN:
        return None

    kinds = sorted({kind_of(c.title) for c in board.cards})
    X = np.array([features(c, wip_at(board, c.started or c.created), kinds) for c in done])
    y = np.array([days_between(c.created, c.done_at) for c in done])

    models = {
        "baseline_median": DummyRegressor(strategy="median"),
        "linear_regression": LinearRegression(),
        "gradient_boosting": GradientBoostingRegressor(
            n_estimators=150, max_depth=2, learning_rate=0.05, random_state=42
        ),
    }
    cv = KFold(n_splits=min(5, len(done) // 4), shuffle=True, random_state=42)
    scores = [
        ModelScore(
            name=name,
            mae_days=float(-cross_val_score(m, X, y, cv=cv, scoring="neg_mean_absolute_error").mean()),
        )
        for name, m in models.items()
    ]
    best = min(scores, key=lambda s: s.mae_days).name
    model = models[best].fit(X, y)

    # Interpretación con el modelo lineal (aunque no sea el ganador, es el explicable).
    linear = LinearRegression().fit(X, y)
    wip_effect = float(linear.coef_[0])
    kind_coefs = dict(zip(kinds, linear.coef_[2:]))
    mean_kind = float(np.mean(list(kind_coefs.values())))
    kind_effect = {k: float(v - mean_kind) for k, v in kind_coefs.items()}

    current_wip = wip_at(board, now)
    pending = [c for c in board.cards if c.done_at is None]
    predictions = []
    for c in pending:
        wip = wip_at(board, c.started) if c.started else current_wip
        pred = float(max(model.predict(np.array([features(c, wip, kinds)]))[0], 0.0))
        elapsed = days_between(c.created, now)
        predictions.append(
            CardPrediction(
                card_id=c.id,
                predicted_lead_time_days=round(pred, 2),
                elapsed_days=round(elapsed, 2),
                remaining_days=round(max(pred - elapsed, 0.0), 2),
                overdue=elapsed > pred,
            )
        )

    return CycleTime(
        n_train=len(done),
        best_model=best,
        scores=scores,
        wip_effect_days=wip_effect,
        kind_effect_days=kind_effect,
        predictions=predictions,
    )
