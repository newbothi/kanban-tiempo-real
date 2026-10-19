import type { MlAnalysis } from '@kanban/shared';
import { describe, expect, it, vi } from 'vitest';
import { MetricsRateLimitError, MetricsService } from '../../src/ml/metrics';

const result = (n: number) => ({ insights: [`análisis ${n}`] }) as unknown as MlAnalysis;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('MetricsService (S-05)', () => {
  it('reutiliza el resultado mientras el tablero no cambie', async () => {
    const svc = new MetricsService();
    const compute = vi.fn(async () => result(1));
    await svc.get('b1', 'u1', 'v1', compute);
    await svc.get('b1', 'u1', 'v1', compute);
    await svc.get('b1', 'u2', 'v1', compute); // también para otros miembros
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recalcula cuando el tablero cambia o vence la caché', async () => {
    const c = clock();
    const svc = new MetricsService({ ttlMs: 60_000, now: c.now });
    const compute = vi.fn(async () => result(1));
    await svc.get('b1', 'u1', 'v1', compute);
    await svc.get('b1', 'u1', 'v2', compute); // cambió
    c.advance(61_000);
    await svc.get('b1', 'u1', 'v2', compute); // venció
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('peticiones simultáneas comparten un solo cálculo', async () => {
    const svc = new MetricsService();
    let release!: () => void;
    const compute = vi.fn(() => new Promise<MlAnalysis>((r) => (release = () => r(result(1)))));
    const all = Promise.all(Array.from({ length: 20 }, (_, i) => svc.get('b1', `u${i}`, 'v1', compute)));
    release();
    const out = await all;
    expect(compute).toHaveBeenCalledTimes(1);
    expect(new Set(out).size).toBe(1);
  });

  it('limita los cálculos por usuario y por minuto', async () => {
    const c = clock();
    const svc = new MetricsService({ computesPerUserPerMinute: 2, now: c.now });
    let n = 0;
    const compute = vi.fn(async () => result(++n));
    await svc.get('b1', 'u1', 'v1', compute);
    await svc.get('b1', 'u1', 'v2', compute);
    // Tercer cálculo en el mismo minuto: devuelve el último guardado sin llamar al ML.
    expect(await svc.get('b1', 'u1', 'v3', compute)).toEqual(result(2));
    expect(compute).toHaveBeenCalledTimes(2);
    // Sin nada guardado para ese tablero: 429 con el tiempo de espera.
    await expect(svc.get('b2', 'u1', 'v1', compute)).rejects.toBeInstanceOf(MetricsRateLimitError);
    // Pasado el minuto, vuelve a poder.
    c.advance(60_001);
    await svc.get('b2', 'u1', 'v1', compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('el límite es por usuario: otro miembro sí puede calcular', async () => {
    const svc = new MetricsService({ computesPerUserPerMinute: 1 });
    const compute = vi.fn(async () => result(1));
    await svc.get('b1', 'u1', 'v1', compute);
    await svc.get('b1', 'u2', 'v2', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('un error del ML no queda guardado y se puede reintentar', async () => {
    const svc = new MetricsService();
    const failing = vi.fn(async () => {
      throw new Error('ML caído');
    });
    await expect(svc.get('b1', 'u1', 'v1', failing)).rejects.toThrow('ML caído');
    const ok = vi.fn(async () => result(1));
    expect(await svc.get('b1', 'u1', 'v1', ok)).toEqual(result(1));
  });
});
