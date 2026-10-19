import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * Tests de punta a punta: levanta la API (que sirve el front ya compilado) contra la base
 * de prueba de apps/api/.env.test y la prueba en Chromium, Firefox, WebKit y un móvil.
 * Con E2E_PROJECTS=chromium (por ejemplo) se corre solo uno.
 */
const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'movil', use: { ...devices['Pixel 7'] } },
];
const only = process.env.E2E_PROJECTS?.split(',');

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  // Sin reintentos: un test que falla "a veces" es un bug del test o de la app, no ruido.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/e2e.json' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: only ? projects.filter((p) => only.includes(p.name)) : projects,
  webServer: {
    command: process.env.E2E_SERVER_CMD ?? 'npm run start:test -w @kanban/api',
    cwd: '../..',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      ENV_FILE: '.env.test',
      LOG_LEVEL: 'warn',
      ML_URL: process.env.ML_URL ?? 'http://localhost:8000',
      // Cuatro navegadores registran usuarios desde la misma IP: se sube el límite de
      // /auth solo para este servidor de prueba (server.ts lo ignora fuera de NODE_ENV=test).
      NODE_ENV: 'test',
      E2E_AUTH_RATE_LIMIT: '500',
    },
  },
});
