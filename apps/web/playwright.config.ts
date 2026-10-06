import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * Tests de punta a punta: levanta la API (que sirve el front ya compilado)
 * contra la base de prueba de apps/api/.env.test y la maneja con Chromium.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_SERVER_CMD ?? 'npm run start:test -w @kanban/api',
    cwd: '../..',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT), ENV_FILE: '.env.test', LOG_LEVEL: 'warn' },
  },
});
