/**
 * Freno por cuenta para el login (S-02): además del límite por IP, cada correo tiene
 * unos intentos libres y después una espera que se duplica con cada fallo.
 *
 * Se aplica igual exista o no el correo, para no revelar qué cuentas están registradas.
 * Vive en memoria (una instancia de la API); el límite por IP sigue siendo la primera barrera.
 */
export interface ThrottleOptions {
  /** Fallos permitidos antes de empezar a esperar. */
  freeAttempts?: number;
  /** Primera espera, en ms. Luego se duplica. */
  baseMs?: number;
  /** Espera máxima, en ms. Tras ese tiempo sin fallos, el contador se reinicia. */
  maxMs?: number;
  /** Cuántos correos recordar como máximo (protege la memoria). */
  maxEntries?: number;
  now?: () => number;
}

interface Entry {
  failures: number;
  lastFailure: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly freeAttempts: number;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: ThrottleOptions = {}) {
    this.freeAttempts = opts.freeAttempts ?? 5;
    this.baseMs = opts.baseMs ?? 60_000;
    this.maxMs = opts.maxMs ?? 15 * 60_000;
    this.maxEntries = opts.maxEntries ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  /** Milisegundos que faltan para poder volver a intentar (0 = puede intentar ya). */
  retryAfterMs(key: string): number {
    const e = this.current(key);
    return e ? Math.max(0, e.lockedUntil - this.now()) : 0;
  }

  fail(key: string): void {
    const now = this.now();
    const e = this.current(key) ?? { failures: 0, lastFailure: now, lockedUntil: 0 };
    e.failures += 1;
    e.lastFailure = now;
    const over = e.failures - this.freeAttempts;
    if (over > 0) e.lockedUntil = now + Math.min(this.baseMs * 2 ** (over - 1), this.maxMs);
    this.entries.delete(key); // reinsertar = queda como la más reciente
    this.entries.set(key, e);
    if (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  success(key: string): void {
    this.entries.delete(key);
  }

  private current(key: string): Entry | undefined {
    const e = this.entries.get(key);
    if (e && this.now() - e.lastFailure > this.maxMs && this.now() >= e.lockedUntil) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }
}
