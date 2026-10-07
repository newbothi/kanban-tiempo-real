import type { BoardDto, MlAnalysis } from '@kanban/shared';
import { ApiError } from '../../api/client';
import { ForecastChart } from './ForecastChart';
import { ModelComparison } from './ModelComparison';
import { ThroughputChart } from './ThroughputChart';
import { fmtDate, fmtDays, fmtNum } from './format';

interface Props {
  board: BoardDto;
  data: MlAnalysis | undefined;
  error: Error | null;
  isFetching: boolean;
}

export function MetricsView({ board, data, error, isFetching }: Props) {
  if (error && !data) {
    const unavailable = error instanceof ApiError && error.status === 503;
    return (
      <div className="metrics-empty">
        <h3>{unavailable ? 'El servicio de análisis no está disponible' : 'No se pudieron calcular las métricas'}</h3>
        <p>
          {unavailable
            ? 'El tablero funciona normalmente; solo el análisis (servicio Python) no responde. En local, levántalo con uvicorn en el puerto 8000.'
            : error.message}
        </p>
      </div>
    );
  }
  if (!data) return <p className="status">Analizando el tablero…</p>;

  const title = new Map(board.cards.map((c) => [c.id, c.title]));
  const column = new Map(board.columns.map((c) => [c.id, c.title]));
  const cardColumn = new Map(board.cards.map((c) => [c.id, column.get(c.columnId) ?? '']));
  const { summary, trend, forecast, cycleTime, stale } = data;
  const pending = summary.backlog + summary.inProgress;
  // Primero lo que ya está en curso (lo accionable); al final lo que espera en la primera columna.
  const firstColumn = [...board.columns].sort((a, b) => (a.position < b.position ? -1 : 1))[0]?.id;
  const waiting = new Set(board.cards.filter((c) => c.columnId === firstColumn).map((c) => c.id));
  const predictions = [...(cycleTime?.predictions ?? [])]
    .filter((p) => title.has(p.cardId))
    .sort(
      (a, b) =>
        Number(waiting.has(a.cardId)) - Number(waiting.has(b.cardId)) ||
        Number(b.overdue) - Number(a.overdue) ||
        a.remainingDays - b.remainingDays,
    );

  return (
    <div className={`metrics${isFetching ? ' is-refreshing' : ''}`}>
      {data.insights.length > 0 && (
        <section className="metrics-card insights">
          <h3>Conclusiones</h3>
          <ul>{data.insights.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}
      {data.warnings.map((w) => (
        <p key={w} className="notice">{w}</p>
      ))}

      <section className="stats">
        <Stat label="Terminadas en las últimas 4 semanas" value={String(summary.doneLast4Weeks)} />
        <Stat
          label="Tiempo de entrega típico"
          value={summary.leadTimeMedianDays != null ? fmtDays(summary.leadTimeMedianDays) : '—'}
          detail={summary.leadTimeP85Days != null ? `85% en ≤ ${fmtDays(summary.leadTimeP85Days)}` : undefined}
        />
        <Stat
          label="Pendientes"
          value={String(pending)}
          detail={`${summary.backlog} por hacer · ${summary.inProgress} en curso`}
        />
        <Stat
          label="Fecha estimada (85%)"
          value={forecast ? fmtDate(forecast.p85.date) : '—'}
          detail={forecast ? `${forecast.p85.weeks} semanas` : 'Falta historial'}
        />
      </section>

      <section className="metrics-card">
        <h3>Ritmo del equipo</h3>
        <p className="hint">
          {trend
            ? trend.direction === 'flat'
              ? `Pendiente no significativa (p = ${fmtNum(trend.pValue, 2)}): el ritmo es estable.`
              : `Pendiente ${trend.slopePerWeek > 0 ? '+' : ''}${fmtNum(trend.slopePerWeek, 2)} tarjetas/semana por semana · IC 95% [${fmtNum(trend.slopeCi95[0], 2)}; ${fmtNum(trend.slopeCi95[1], 2)}] · R² ${fmtNum(trend.r2, 2)} · p ${fmtNum(trend.pValue, 3)}`
            : 'Se necesitan al menos 4 semanas de actividad para la tendencia.'}
        </p>
        {data.throughput.length > 0 ? <ThroughputChart points={data.throughput} /> : <p className="status">Sin datos aún.</p>}
      </section>

      {forecast && (
        <section className="metrics-card">
          <h3>¿Cuándo terminamos lo pendiente?</h3>
          <p className="hint">
            Simulación Monte Carlo: {forecast.simulations.toLocaleString('es-CL')} futuros posibles armados con semanas
            reales de las últimas {forecast.weeksOfHistory} semanas, para {forecast.remaining} tarjetas pendientes.
          </p>
          <ForecastChart forecast={forecast} />
        </section>
      )}

      {cycleTime && (
        <div className="metrics-grid">
          <section className="metrics-card">
            <h3>Modelos de predicción</h3>
            <ModelComparison cycleTime={cycleTime} />
          </section>
          <section className="metrics-card">
            <h3>Qué influye en el tiempo de entrega</h3>
            <ul className="effects">
              <li>
                <strong>+{fmtDays(cycleTime.wipEffectDays)}</strong> por cada tarjeta adicional en curso al empezar
              </li>
              {Object.entries(cycleTime.kindEffectDays)
                .sort((a, b) => b[1] - a[1])
                .map(([kind, days]) => (
                  <li key={kind}>
                    <strong>{days >= 0 ? '+' : '−'}{fmtDays(Math.abs(days))}</strong> si es {kind}
                  </li>
                ))}
            </ul>
            <p className="hint">Coeficientes de la regresión lineal (efecto respecto del promedio).</p>
          </section>
        </div>
      )}

      {predictions.length > 0 && (
        <section className="metrics-card">
          <h3>Predicción para lo pendiente</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Tarjeta</th><th>Columna</th><th>Lleva</th><th>Estimado total</th><th>Le quedan</th></tr>
              </thead>
              <tbody>
                {predictions.slice(0, 12).map((p) => (
                  <tr key={p.cardId}>
                    <td>{title.get(p.cardId)}</td>
                    <td>{cardColumn.get(p.cardId)}</td>
                    <td>{fmtDays(p.elapsedDays)}</td>
                    <td>{fmtDays(p.predictedLeadTimeDays)}</td>
                    <td>
                      {p.overdue ? (
                        <span className="status-tag status-tag--serious">⚠ Atrasada</span>
                      ) : (
                        `~${fmtDays(p.remainingDays)}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {predictions.length > 12 && <p className="hint">Y {predictions.length - 12} más.</p>}
        </section>
      )}

      <section className="metrics-card">
        <h3>Tarjetas estancadas</h3>
        {stale.length === 0 ? (
          <p className="hint">Ninguna tarjeta en curso supera lo habitual para su columna.</p>
        ) : (
          <ul className="stale-list">
            {stale.filter((s) => title.has(s.cardId)).map((s) => (
              <li key={s.cardId}>
                <span className="status-tag status-tag--serious">⚠ Estancada</span>
                <span>
                  <strong>{title.get(s.cardId)}</strong> lleva {fmtDays(s.daysInColumn)} en {column.get(s.columnId)}
                  <span className="hint"> (lo normal: {fmtDays(s.typicalDays)}; umbral {fmtDays(s.thresholdDays)})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Umbral por columna con la regla del rango intercuartil (Q3 + 1,5·IQR).</p>
      </section>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {detail && <span className="stat__detail">{detail}</span>}
    </div>
  );
}
