import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/*.test.ts'], // integración (los unitarios están en test/unit)
    setupFiles: ['test/setup-env.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Todos los archivos usan la MISMA base de datos de prueba: uno a la vez.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
