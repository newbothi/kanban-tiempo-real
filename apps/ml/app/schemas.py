"""Contrato de la API (entrada y salida).

Los campos se exponen en camelCase porque así los usa el resto del sistema (TypeScript).
A partir de estos modelos FastAPI genera el esquema OpenAPI, y desde ese esquema
se generan los tipos de TypeScript que usa Node (packages/shared/src/ml-api.ts).
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------- Entrada ----------

class ColumnIn(Model):
    id: str
    title: str
    position: str = Field(description="Clave de orden (fractional indexing). La menor es la primera columna.")


class CardIn(Model):
    id: str
    title: str
    column_id: str
    created_at: datetime


class EventIn(Model):
    card_id: str
    type: Literal["created", "moved", "deleted"]
    from_column_id: str | None = None
    to_column_id: str | None = None
    at: datetime


class AnalyzeRequest(Model):
    now: datetime
    columns: list[ColumnIn]
    cards: list[CardIn]
    events: list[EventIn]
    simulations: int = Field(default=10_000, ge=1_000, le=50_000)


# ---------- Salida ----------

class Summary(Model):
    cards_total: int
    backlog: int = Field(description="Tarjetas en la primera columna")
    in_progress: int = Field(description="Tarjetas en columnas intermedias")
    done: int = Field(description="Tarjetas en la última columna")
    done_last_4_weeks: int
    lead_time_median_days: float | None
    lead_time_p85_days: float | None


class WeekPoint(Model):
    week_start: datetime
    done: int
    trend: float | None = Field(description="Valor de la recta de regresión para esa semana")


class Trend(Model):
    slope_per_week: float = Field(description="Cambio del throughput por semana (tarjetas/semana²)")
    intercept: float
    r2: float
    p_value: float
    slope_ci95: tuple[float, float]
    direction: Literal["up", "down", "flat"] = Field(description="'flat' si la pendiente no es significativa (p ≥ 0,05)")


class ForecastPoint(Model):
    weeks: int
    date: datetime


class HistogramBin(Model):
    weeks: int
    probability: float


class Forecast(Model):
    remaining: int
    simulations: int
    weeks_of_history: int
    p50: ForecastPoint
    p85: ForecastPoint
    p95: ForecastPoint
    histogram: list[HistogramBin]


class ModelScore(Model):
    name: Literal["baseline_median", "linear_regression", "gradient_boosting"]
    mae_days: float = Field(description="Error absoluto medio en validación cruzada (días)")


class CardPrediction(Model):
    card_id: str
    predicted_lead_time_days: float
    elapsed_days: float
    remaining_days: float
    overdue: bool = Field(description="Ya lleva más tiempo que lo predicho")


class CycleTime(Model):
    n_train: int
    best_model: Literal["baseline_median", "linear_regression", "gradient_boosting"]
    scores: list[ModelScore]
    wip_effect_days: float = Field(description="Días extra por cada tarjeta adicional en curso (coeficiente lineal)")
    kind_effect_days: dict[str, float] = Field(description="Efecto de cada tipo de tarea vs. el promedio (lineal)")
    predictions: list[CardPrediction]


class StaleCard(Model):
    card_id: str
    column_id: str
    days_in_column: float
    typical_days: float = Field(description="Mediana histórica de permanencia en esa columna")
    threshold_days: float = Field(description="Umbral IQR: Q3 + 1,5·IQR")


class AnalyzeResponse(Model):
    generated_at: datetime
    summary: Summary
    throughput: list[WeekPoint]
    trend: Trend | None
    forecast: Forecast | None
    cycle_time: CycleTime | None
    stale: list[StaleCard]
    insights: list[str] = Field(description="Conclusiones en lenguaje natural para mostrar en la UI")
    warnings: list[str]
