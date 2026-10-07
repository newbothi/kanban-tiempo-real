import { expect, test, type Browser, type Page } from '@playwright/test';

// Correos únicos por ejecución: no hace falta limpiar la base entre corridas.
const run = Date.now().toString(36);
const users = {
  ana: { name: 'Ana', email: `ana-${run}@e2e.cl`, password: 'clave-ana-123' },
  beto: { name: 'Beto', email: `beto-${run}@e2e.cl`, password: 'clave-beto-123' },
};

/** Cada usuario en su propio contexto = como si fueran dos navegadores distintos. */
async function newUserPage(browser: Browser) {
  const context = await browser.newContext();
  return context.newPage();
}

async function register(page: Page, u: (typeof users)['ana']) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Nombre').fill(u.name);
  await page.getByLabel('Correo').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).last().click();
  await expect(page.getByText(u.name, { exact: true })).toBeVisible();
}

const column = (page: Page, title: string) =>
  page.locator('section.column').filter({ has: page.getByRole('heading', { name: title }) });

/** Arrastre "humano" (dnd-kit necesita movimiento real del puntero, no un drop instantáneo). */
async function drag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 30, { steps: 15 });
  await page.mouse.up();
}

test('login: credenciales incorrectas muestran un error', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Correo').fill('nadie@e2e.cl');
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos');
});

test('dos usuarios colaboran en tiempo real', async ({ browser }) => {
  const ana = await newUserPage(browser);
  const beto = await newUserPage(browser);

  await test.step('ambos crean su cuenta', async () => {
    await register(ana, users.ana);
    await register(beto, users.beto);
    await expect(beto.getByText('Aún no tienes tableros')).toBeVisible();
  });

  await test.step('Ana crea un tablero y una tarjeta', async () => {
    await ana.getByLabel('Nombre del nuevo tablero').fill('Sprint E2E');
    await ana.getByLabel('Nombre del nuevo tablero').press('Enter');
    await expect(ana.getByRole('heading', { name: 'Sprint E2E' })).toBeVisible();
    await ana.getByLabel('Nueva tarjeta en Por hacer').fill('Escribir tests E2E');
    await ana.getByLabel('Nueva tarjeta en Por hacer').press('Enter');
    await expect(column(ana, 'Por hacer').getByText('Escribir tests E2E')).toBeVisible();
  });

  await test.step('Beto no puede ver el tablero antes de ser invitado', async () => {
    const boardId = new URL(ana.url()).hash.slice(1);
    const res = await beto.request.get(`/api/boards/${boardId}`);
    expect(res.status()).toBe(404);
  });

  await test.step('Ana invita a Beto y le aparece el tablero sin recargar', async () => {
    await ana.getByRole('button', { name: 'Miembros' }).click();
    await ana.getByLabel('Invitar por correo').fill(users.beto.email);
    await ana.getByRole('button', { name: 'Invitar' }).click();
    await expect(ana.getByText(users.beto.email)).toBeVisible();
    await beto.getByRole('button', { name: /Sprint E2E/ }).click();
    await expect(beto.getByText('Escribir tests E2E')).toBeVisible();
  });

  await test.step('ambos se ven conectados', async () => {
    await expect(ana.getByText('En vivo · 2 conectados')).toBeVisible();
    await expect(beto.getByText('En vivo · 2 conectados')).toBeVisible();
  });

  await test.step('Beto (miembro) no tiene opciones de dueño', async () => {
    await expect(beto.getByRole('button', { name: 'Eliminar tablero' })).toHaveCount(0);
  });

  await test.step('lo que crea Beto le aparece a Ana', async () => {
    await beto.getByLabel('Nueva tarjeta en En progreso').fill('Tarjeta de Beto');
    await beto.getByLabel('Nueva tarjeta en En progreso').press('Enter');
    await expect(column(ana, 'En progreso').getByText('Tarjeta de Beto')).toBeVisible();
  });

  await test.step('Beto arrastra una tarjeta a Hecho y Ana lo ve', async () => {
    await drag(beto, beto.getByText('Escribir tests E2E'), column(beto, 'Hecho'));
    await expect(column(beto, 'Hecho').getByText('Escribir tests E2E')).toBeVisible();
    await expect(column(ana, 'Hecho').getByText('Escribir tests E2E')).toBeVisible();
    await expect(column(ana, 'Por hacer').getByText('Escribir tests E2E')).toHaveCount(0);
  });

  await test.step('el cambio quedó guardado (sobrevive a recargar)', async () => {
    await ana.reload();
    await expect(column(ana, 'Hecho').getByText('Escribir tests E2E')).toBeVisible();
  });

  await test.step('la pestaña Métricas muestra el análisis (o un aviso si el servicio ML no está)', async () => {
    await ana.getByRole('tab', { name: 'Métricas' }).click();
    if (process.env.E2E_EXPECT_ML) {
      await expect(ana.getByRole('heading', { name: 'Ritmo del equipo' })).toBeVisible();
      await expect(ana.getByText('Pendientes', { exact: true })).toBeVisible();
    } else {
      await expect(
        ana.getByRole('heading', { name: /Ritmo del equipo|El servicio de análisis no está disponible/ }),
      ).toBeVisible();
    }
    await ana.getByRole('tab', { name: 'Tablero' }).click();
  });

  await test.step('Ana quita a Beto y él pierde el acceso al instante', async () => {
    await ana.getByRole('button', { name: 'Miembros' }).click();
    await ana.getByRole('button', { name: 'Quitar' }).click();
    await expect(beto.getByText(/fue eliminado o ya no tienes acceso/)).toBeVisible();
    await expect(beto.getByRole('button', { name: /Sprint E2E/ })).toHaveCount(0);
  });
});
