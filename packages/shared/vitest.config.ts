import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/ml-api.ts', 'src/index.ts', 'src/types.ts'], // generado / solo tipos
      reporter: ['text-summary', 'json-summary', 'html'],
      // Umbral mínimo (fase 3): si baja, el CI falla.
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
