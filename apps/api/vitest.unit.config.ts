import { defineConfig } from 'vitest/config';

/** Tests unitarios de la API: no necesitan SQL Server (corren en el job "check" del CI). */
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
  },
});
