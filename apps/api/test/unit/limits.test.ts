import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../../src/limits';

describe('SlidingWindowLimiter (S-16)', () => {
  it('permite hasta el máximo por ventana y dice cuánto esperar', () => {
    let t = 0;
    const l = new SlidingWindowLimiter(2, 1000, () => t);
    expect(l.take('u')).toBe(0);
    t = 100;
    expect(l.take('u')).toBe(0);
    t = 200;
    expect(l.take('u')).toBe(800); // el primero vence en t=1000
    t = 1001;
    expect(l.take('u')).toBe(0);
  });

  it('cada clave tiene su propio contador y se puede olvidar', () => {
    const l = new SlidingWindowLimiter(1, 1000);
    expect(l.take('a')).toBe(0);
    expect(l.take('b')).toBe(0);
    expect(l.take('a')).toBeGreaterThan(0);
    l.forget('a');
    expect(l.take('a')).toBe(0);
  });
});
