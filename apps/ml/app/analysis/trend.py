"""Regresión lineal del throughput semanal: ¿el equipo va más rápido o más lento?"""
from scipy import stats

from app.schemas import Trend

MIN_WEEKS = 4


def fit(counts: list[int]) -> tuple[Trend, list[float]] | None:
    n = len(counts)
    if n < MIN_WEEKS or len(set(counts)) == 1:
        return None
    x = list(range(n))
    r = stats.linregress(x, counts)
    t = stats.t.ppf(0.975, n - 2)
    ci = (r.slope - t * r.stderr, r.slope + t * r.stderr)
    significant = r.pvalue < 0.05
    direction = "flat" if not significant else ("up" if r.slope > 0 else "down")
    trend = Trend(
        slope_per_week=float(r.slope),
        intercept=float(r.intercept),
        r2=float(r.rvalue**2),
        p_value=float(r.pvalue),
        slope_ci95=(float(ci[0]), float(ci[1])),
        direction=direction,
    )
    fitted = [float(r.intercept + r.slope * i) for i in x]
    return trend, fitted
