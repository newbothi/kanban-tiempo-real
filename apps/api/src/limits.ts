/**
 * Límite de frecuencia en memoria con ventana deslizante (S-16).
 * Sirve para cosas por usuario (escrituras, invitaciones) donde el límite por IP
 * de @fastify/rate-limit no alcanza: un usuario puede cambiar de IP, y varios
 * usuarios legítimos pueden compartir una.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Registra un intento. Devuelve 0 si se permite, o los ms que faltan para poder. */
  take(key: string): number {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return recent[0]! + this.windowMs - now;
    }
    recent.push(now);
    this.hits.delete(key); // reinsertar = queda como la más reciente
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    return 0;
  }

  forget(key: string): void {
    this.hits.delete(key);
  }
}

/** Topes por usuario y por tablero. Configurables para los tests. */
export interface LimitsOptions {
  /** Creaciones, cambios y borrados por usuario y por minuto. */
  writesPerMinute?: number;
  /** Tableros de los que un usuario puede ser dueño. */
  boardsPerOwner?: number;
  /** Tarjetas por tablero (menos que el tope del análisis ML). */
  cardsPerBoard?: number;
  /** Eventos de WebSocket por conexión cada 10 segundos. */
  socketEventsPer10s?: number;
}

export function resolveLimits(opts: LimitsOptions = {}): Required<LimitsOptions> {
  return {
    writesPerMinute: opts.writesPerMinute ?? 120,
    boardsPerOwner: opts.boardsPerOwner ?? 50,
    cardsPerBoard: opts.cardsPerBoard ?? 2_000,
    socketEventsPer10s: opts.socketEventsPer10s ?? 30,
  };
}
