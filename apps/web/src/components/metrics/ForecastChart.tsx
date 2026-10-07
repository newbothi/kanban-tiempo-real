import { useState } from 'react';
import type { MlForecast } from '@kanban/shared';
import { columnPath, fmtDate, fmtPct, niceMax } from './format';
import { Tooltip } from './Tooltip';
import { useWidth } from './useWidth';

const H = 220;
const M = { top: 34, right: 16, bottom: 26, left: 40 };

/** Histograma de la simulación: probabilidad de terminar en exactamente N semanas. */
export function ForecastChart({ forecast }: { forecast: MlForecast }) {
  const [hover, setHover] = useState<number | null>(null);
  const [canvasRef, W] = useWidth<HTMLDivElement>();

  // Rellenar semanas sin simulaciones para que el eje sea continuo.
  const byWeek = new Map(forecast.histogram.map((b) => [b.weeks, b.probability]));
  const minW = Math.min(...byWeek.keys());
  const maxW = Math.max(...byWeek.keys());
  const bins = Array.from({ length: maxW - minW + 1 }, (_, i) => ({
    weeks: minW + i,
    probability: byWeek.get(minW + i) ?? 0,
  }));

  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxY = niceMax(Math.max(...bins.map((b) => b.probability)));
  const band = plotW / bins.length;
  const barW = Math.min(24, band * 0.7);
  const xCenter = (weeks: number) => M.left + band * (weeks - minW) + band / 2;
  const y = (v: number) => M.top + plotH - (v / maxY) * plotH;

  // Percentiles que caen en la misma semana comparten una sola marca (sin etiquetas encimadas).
  const marks = new Map<number, string[]>();
  for (const [name, p] of [['p50', forecast.p50], ['p85', forecast.p85], ['p95', forecast.p95]] as const) {
    marks.set(p.weeks, [...(marks.get(p.weeks) ?? []), name]);
  }
  let cumulative = 0;
  const cum = bins.map((b) => (cumulative += b.probability));

  return (
    <figure className="chart">
      <div className="chart__canvas" ref={canvasRef}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distribución de semanas hasta terminar el trabajo pendiente">
          {[0, maxY / 2, maxY].map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text className="chart-axis" x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{fmtPct(t)}</text>
            </g>
          ))}
          {bins.map((b) => (
            <g key={b.weeks}>
              <path
                className={`chart-bar${hover === b.weeks ? ' is-hover' : ''}`}
                d={columnPath(xCenter(b.weeks) - barW / 2, y(b.probability), barW, y(0) - y(b.probability))}
              />
              {(b.weeks - minW) % Math.ceil(bins.length / Math.max(3, Math.floor(plotW / 40))) === 0 && (
                <text className="chart-axis" x={xCenter(b.weeks)} y={H - 8} textAnchor="middle">{b.weeks}</text>
              )}
            </g>
          ))}
          {[...marks].map(([weeks, names]) => (
            <g key={weeks}>
              <line className="chart-ref" x1={xCenter(weeks)} x2={xCenter(weeks)} y1={M.top - 6} y2={y(0)} />
              <text className="chart-ref-label" x={xCenter(weeks)} y={M.top - 12} textAnchor="middle">
                {names.join(' · ')}
              </text>
            </g>
          ))}
          {bins.map((b) => (
            <rect
              key={`hit-${b.weeks}`}
              className="chart-hit"
              x={xCenter(b.weeks) - band / 2}
              y={M.top}
              width={band}
              height={plotH}
              tabIndex={0}
              aria-label={`${b.weeks} semanas: ${fmtPct(b.probability)}`}
              onPointerEnter={() => setHover(b.weeks)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(b.weeks)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        {hover != null && (
          <Tooltip
            x={(xCenter(hover) / W) * 100}
            y={(y(bins[hover - minW].probability) / H) * 100}
          >
            <strong>{fmtPct(bins[hover - minW].probability)}</strong>
            <span>de terminar en {hover} {hover === 1 ? 'semana' : 'semanas'}</span>
            <span>{fmtPct(cum[hover - minW])} de terminar en {hover} o menos</span>
          </Tooltip>
        )}
      </div>
      <figcaption className="chart__caption">
        Semanas hasta terminar · p50 {fmtDate(forecast.p50.date)} · <strong>p85 {fmtDate(forecast.p85.date)}</strong> · p95{' '}
        {fmtDate(forecast.p95.date)}
      </figcaption>
    </figure>
  );
}
