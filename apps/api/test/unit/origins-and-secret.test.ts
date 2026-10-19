import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJwtSecret } from '../../src/auth/secret';
import { allowedOrigins } from '../../src/origins';

afterEach(() => vi.unstubAllEnvs());

describe('S-15: orígenes permitidos', () => {
  it('en producción, sin WEB_ORIGIN, no se permite ningún origen externo', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEB_ORIGIN', '');
    expect(allowedOrigins()).toEqual([]);
  });

  it('en desarrollo se permite Vite por defecto', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WEB_ORIGIN', '');
    expect(allowedOrigins()).toEqual(['http://localhost:5173']);
  });

  it('acepta una lista separada por comas', () => {
    vi.stubEnv('WEB_ORIGIN', 'https://a.cl, https://b.cl');
    expect(allowedOrigins()).toEqual(['https://a.cl', 'https://b.cl']);
  });
});

describe('S-13: JWT_SECRET', () => {
  it('rechaza secretos cortos', () => {
    vi.stubEnv('JWT_SECRET', 'corto');
    expect(() => getJwtSecret()).toThrow(/32 caracteres/);
  });

  it('en producción rechaza los valores de ejemplo publicados en el repo', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'reemplaza-esto-por-un-secreto-aleatorio-de-al-menos-32-caracteres');
    expect(() => getJwtSecret()).toThrow(/ejemplo/);
  });

  it('acepta un secreto aleatorio', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'Zk3q9f0l2PqR7sT1uV5wX8yA4bC6dE0gH2jK4mN6pQ8r');
    expect(getJwtSecret()).toBe('Zk3q9f0l2PqR7sT1uV5wX8yA4bC6dE0gH2jK4mN6pQ8r');
  });
});
