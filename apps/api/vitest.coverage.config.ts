import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

/**
 * Cobertura de la API: unitarios + integración contra SQL Server (job "integration" del CI).
 * Umbral mínimo 80 %: si un PR lo baja, el CI falla.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/*.test.ts', 'test/unit/**/*.test.ts'],
      coverage: {
        enabled: true,
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/generated/**', 'src/server.ts'],
        reporter: ['text-summary', 'json-summary', 'html'],
        thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  }),
);
