import type { MlAnalysis } from '@kanban/shared';

/**
 * Topes del análisis. Deben coincidir con apps/ml/app/schemas.py (MAX_CARDS, MAX_EVENTS):
 * si Node los aplica primero, nunca se manda al servicio ML algo que va a rechazar.
 */
export const ML_LIMITS = {
  cards: 5_000,
  events: 40_000,
  /** Eventos que se llegan a leer de la base (incluye los de tarjetas ya borradas). */
  eventsScanned: 80_000,
} as const;

export class BoardTooLargeError extends Error {}

export class MetricsRateLimitError extends Error {
  constructor(readonly retryAfterSec: number) {
    super('Demasiados cálculos de métricas');
  }
}

export interface MetricsOptions {
  /** Cuánto dura un resultado en caché si el tablero no cambió (ms). */
  ttlMs?: number;
  /** Cálculos nuevos que puede pedir cada usuario por minuto. */
  computesPerUserPerMinute?: number;
  now?: () => number;
}

interface CacheEntry {
  version: string;
  at: number;
  data: MlAnalysis;
}

const MINUTE = 60_000;
const MAX_CACHED_BOARDS = 500;
const MAX_TRACKED_USERS = 10_000;

/**
 * Evita que /metrics se use para agotar la CPU (S-05):
 * - caché por tablero, válida mientras el tablero no cambie (versión) y por `ttlMs`;
 * - un solo cálculo en curso por tablero y versión (las peticiones simultáneas lo comparten);
 * - cada usuario puede pedir pocos cálculos nuevos por minuto. Si se pasa, recibe el
 *   último resultado guardado (aunque esté algo desactualizado) o, si no hay, un 429.
 */
export class MetricsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<MlAnalysis>>();
  private readonly computes = new Map<string, number[]>();
  private readonly ttlMs: number;
  private readonly perMinute: number;
  private readonly now: () => number;

  constructor(opts: MetricsOptions = {}) {
    this.ttlMs = opts.ttlMs ?? MINUTE;
    this.perMinute = opts.computesPerUserPerMinute ?? 5;
    this.now = opts.now ?? Date.now;
  }

  async get(
    boardId: string,
    userId: string,
    version: string,
    compute: () => Promise<MlAnalysis>,
  ): Promise<MlAnalysis> {
    const cached = this.cache.get(boardId);
    if (cached && cached.version === version && this.now() - cached.at < this.ttlMs) {
      return cached.data;
    }

    const key = `${boardId}:${version}`;
    const running = this.inflight.get(key);
    if (running) return running;

    const wait = this.takeBudget(userId);
    if (wait > 0) {
      if (cached) return cached.data; // mejor un resultado algo viejo que un error
      throw new MetricsRateLimitError(Math.ceil(wait / 1000));
    }

    const promise = compute()
      .then((data) => {
        this.remember(boardId, { version, at: this.now(), data });
        return data;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  /** Registra un cálculo del usuario; devuelve cuánto debe esperar (0 = puede calcular). */
  private takeBudget(userId: string): number {
    const now = this.now();
    const recent = (this.computes.get(userId) ?? []).filter((t) => now - t < MINUTE);
    if (recent.length >= this.perMinute) {
      this.computes.set(userId, recent);
      return recent[0]! + MINUTE - now;
    }
    recent.push(now);
    this.computes.delete(userId);
    this.computes.set(userId, recent);
    if (this.computes.size > MAX_TRACKED_USERS) {
      this.computes.delete(this.computes.keys().next().value!);
    }
    return 0;
  }

  private remember(boardId: string, entry: CacheEntry) {
    this.cache.delete(boardId);
    this.cache.set(boardId, entry);
    if (this.cache.size > MAX_CACHED_BOARDS) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }
}
