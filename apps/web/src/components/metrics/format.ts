const dateFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit' });

export const fmtDate = (iso: string) => dateFmt.format(new Date(iso));
export const fmtShort = (iso: string) => shortFmt.format(new Date(iso));
/** 2.71 → "2,7" (coma decimal chilena) */
export const fmtNum = (x: number, decimals = 1) =>
  x.toLocaleString('es-CL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
export const fmtDays = (x: number) => `${fmtNum(x)} ${Math.abs(x - 1) < 0.05 ? 'día' : 'días'}`;
export const fmtPct = (x: number) => `${Math.round(x * 100)}%`;

/** Máximo "redondo" para el eje Y (5, 10, 20, 25, 50…) */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * exp;
}

/** Columna con esquinas superiores redondeadas (4px) y base recta. */
export function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
