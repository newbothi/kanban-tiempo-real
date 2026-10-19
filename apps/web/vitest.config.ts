import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

/** Tests de componentes del front: jsdom + Testing Library, con la API y el socket simulados. */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{ts,tsx}'],
      setupFiles: ['test/setup.ts'],
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/main.tsx', 'src/**/*.d.ts'],
        reporter: ['text-summary', 'json-summary', 'html'],
        // Umbral mínimo del front: el estudio pedía 60 %; se fija en 75 % porque hoy está sobre 80 %.
        thresholds: { statements: 75, branches: 75, functions: 75, lines: 75 },
      },
    },
  }),
);
