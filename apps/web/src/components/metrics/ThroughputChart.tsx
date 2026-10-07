import { useState } from 'react';
import type { MlWeekPoint } from '@kanban/shared';
import { columnPath, fmtNum, fmtShort, niceMax } from './format';
import { Tooltip } from './Tooltip';
import { useWidth } from './useWidth';

const H = 220;
const M = { top: 14, right: 16, bottom: 26, left: 30 };

/** Columnas: tarjetas terminadas por semana. Línea: recta de regresión (mismo eje, misma unidad). */
export function ThroughputChart({ points }: { points: MlWeekPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [canvasRef, W] = useWidth<HTMLDivElement>();
  const [asTable, setAsTable] = useState(false);
  const hasTrend = points.some((p) => p.trend != null);

  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxY = niceMax(Math.max(...points.map((p) => Math.max(p.done, p.trend ?? 0)), 1));
  const ticks = [0, maxY / 2, maxY];
  const band = plotW / points.length;
  const barW = Math.min(24, band * 0.7);
  const xCenter = (i: number) => M.left + band * i + band / 2;
  const y = (v: number) => M.top + plotH - (v / maxY) * plotH;
  const labelEvery = Math.ceil(points.length / Math.max(3, Math.floor(plotW / 70)));

  const trendPath = hasTrend
    ? points.map((p, i) => `${i ? 'L' : 'M'}${xCenter(i)},${y(p.trend ?? 0)}`).join('')
    : '';
  const last = points.length - 1;

  return (
    <figure className="chart">
      <div className="chart__head">
        <div className="chart__legend">
          <span><i className="key key--bar" /> Terminadas por semana</span>
          {hasTrend && <span><i className="key key--line" /> Tendencia (regresión lineal)</span>}
        </div>
        <button className="link" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Ver gráfico' : 'Ver como tabla'}
        </button>
      </div>

      {asTable ? (
        <table className="data-table">
          <thead>
            <tr><th>Semana desde</th><th>Terminadas</th>{hasTrend && <th>Tendencia</th>}</tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.weekStart}>
                <td>{fmtShort(p.weekStart)}</td>
                <td>{p.done}</td>
                {hasTrend && <td>{p.trend != null ? fmtNum(p.trend) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart__canvas" ref={canvasRef}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tarjetas terminadas por semana con su línea de tendencia">
            {ticks.map((t) => (
              <g key={t}>
                <line className="chart-grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
                <text className="chart-axis" x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
              </g>
            ))}
            {points.map((p, i) => (
              <g key={p.weekStart}>
                <path
                  className={`chart-bar${hover === i ? ' is-hover' : ''}`}
                  d={columnPath(xCenter(i) - barW / 2, y(p.done), barW, y(0) - y(p.done))}
                />
                {i % labelEvery === 0 && (
                  <text className="chart-axis" x={xCenter(i)} y={H - 8} textAnchor="middle">
                    {fmtShort(p.weekStart)}
                  </text>
                )}
              </g>
            ))}
            {hasTrend && (
              <>
                <path className="chart-line" d={trendPath} />
                <circle className="chart-dot" cx={xCenter(last)} cy={y(points[last].trend ?? 0)} r={4} />
              </>
            )}
            {/* Zonas de hover: toda la banda de cada semana, más grande que la columna */}
            {points.map((p, i) => (
              <rect
                key={`hit-${p.weekStart}`}
                className="chart-hit"
                x={M.left + band * i}
                y={M.top}
                width={band}
                height={plotH}
                tabIndex={0}
                aria-label={`Semana del ${fmtShort(p.weekStart)}: ${p.done} terminadas`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </svg>
          {hover != null && (
            <Tooltip x={(xCenter(hover) / W) * 100} y={(y(points[hover].done) / H) * 100}>
              <strong>{points[hover].done} terminadas</strong>
              <span>Semana desde el {fmtShort(points[hover].weekStart)}</span>
              {points[hover].trend != null && (
                <span><i className="key key--line" /> Tendencia: {fmtNum(points[hover].trend!)}</span>
              )}
            </Tooltip>
          )}
        </div>
      )}
    </figure>
  );
}
