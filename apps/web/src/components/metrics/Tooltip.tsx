import type { ReactNode } from 'react';

/** Tooltip posicionado sobre el gráfico (coordenadas en % del contenedor). */
export function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const alignRight = x > 70;
  return (
    <div
      className="chart-tooltip"
      role="status"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: `translate(${alignRight ? 'calc(-100% - 10px)' : '10px'}, -100%)`,
      }}
    >
      {children}
    </div>
  );
}
