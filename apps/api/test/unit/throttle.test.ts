import { describe, expect, it } from 'vitest';
import { LoginThrottle } from '../../src/auth/throttle';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('LoginThrottle (S-02: freno por cuenta)', () => {
  it('deja los primeros intentos libres y después exige esperar', () => {
    const c = clock();
    const th = new LoginThrottle({ freeAttempts: 3, baseMs: 1000, now: c.now });
    for (let i = 0; i < 3; i++) {
      expect(th.retryAfterMs('ana@x.cl')).toBe(0);
      th.fail('ana@x.cl');
    }
    expect(th.retryAfterMs('ana@x.cl')).toBe(0); // 3 fallos = todavía libres
    th.fail('ana@x.cl'); // 4.º fallo
    expect(th.retryAfterMs('ana@x.cl')).toBe(1000);
  });

  it('la espera se duplica con cada fallo y tiene un máximo', () => {
    const c = clock();
    const th = new LoginThrottle({ freeAttempts: 0, baseMs: 1000, maxMs: 5000, now: c.now });
    const waits = [];
    for (let i = 0; i < 5; i++) {
      th.fail('x');
      waits.push(th.retryAfterMs('x'));
    }
    expect(waits).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  it('cambiar de IP no sirve: la clave es el correo', () => {
    const c = clock();
    const th = new LoginThrottle({ freeAttempts: 1, baseMs: 1000, now: c.now });
    th.fail('ana@x.cl');
    th.fail('ana@x.cl');
    expect(th.retryAfterMs('ana@x.cl')).toBeGreaterThan(0);
    expect(th.retryAfterMs('beto@x.cl')).toBe(0); // otras cuentas no se ven afectadas
  });

  it('un login correcto reinicia el contador', () => {
    const c = clock();
    const th = new LoginThrottle({ freeAttempts: 1, baseMs: 1000, now: c.now });
    th.fail('x');
    th.success('x');
    th.fail('x');
    expect(th.retryAfterMs('x')).toBe(0);
  });

  it('tras la espera máxima sin fallos, olvida la cuenta', () => {
    const c = clock();
    const th = new LoginThrottle({ freeAttempts: 0, baseMs: 1000, maxMs: 5000, now: c.now });
    th.fail('x');
    c.advance(6000);
    th.fail('x');
    expect(th.retryAfterMs('x')).toBe(1000); // volvió a empezar desde la primera espera
  });

  it('no crece sin límite en memoria', () => {
    const th = new LoginThrottle({ maxEntries: 100 });
    for (let i = 0; i < 1000; i++) th.fail(`u${i}@x.cl`);
    // La más antigua se olvidó; la más reciente sigue.
    expect(th.retryAfterMs('u0@x.cl')).toBe(0);
    expect((th as unknown as { entries: Map<string, unknown> }).entries.size).toBe(100);
  });
});
