import { generateKeyBetween } from 'fractional-indexing';

type Positioned = { position: string };

/**
 * Compara claves de fractional indexing byte a byte.
 * NO usar localeCompare: el orden debe ser binario (mayúsculas antes que minúsculas).
 * Por la misma razón, en SQL Server la columna `position` usa COLLATE Latin1_General_BIN2.
 */
export const byPosition = (a: Positioned, b: Positioned) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export function sortByPosition<T extends Positioned>(items: T[]): T[] {
  return [...items].sort(byPosition);
}

/** Clave para quedar al final de una lista ordenada. */
export function keyAtEnd(sorted: Positioned[]): string {
  return generateKeyBetween(sorted[sorted.length - 1]?.position ?? null, null);
}

/**
 * Clave para quedar en `index` dentro de una lista ordenada
 * que NO incluye al elemento que se mueve.
 */
export function keyAtIndex(sorted: Positioned[], index: number): string {
  const i = Math.max(0, Math.min(index, sorted.length));
  return generateKeyBetween(sorted[i - 1]?.position ?? null, sorted[i]?.position ?? null);
}
