import { expect, test } from '@playwright/test';
import { addCard, checkCspAfterEach, column, createBoard, drag, makeUser, newUserPage, register } from './helpers.ts';

checkCspAfterEach();

test('login: credenciales incorrectas muestran un error', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Correo').fill(makeUser('Nadie').email);
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos');
});

test('dos usuarios colaboran en tiempo real', async ({ browser }, info) => {
  // En el móvil las columnas quedan una bajo otra: el arrastre entre columnas se prueba en escritorio.
  test.skip(info.project.name === 'movil', 'flujo de escritorio (arrastre entre columnas)');
  const users = { ana: makeUser('Ana'), beto: makeUser('Beto') };
  const ana = await newUserPage(browser);
  const beto = await newUserPage(browser);

  await test.step('ambos crean su cuenta', async () => {
    await register(ana, users.ana);
    await register(beto, users.beto);
    await expect(beto.getByText('Aún no tienes tableros')).toBeVisible();
  });

  await test.step('Ana crea un tablero y una tarjeta', async () => {
    await createBoard(ana, 'Sprint E2E');
    await addCard(ana, 'Por hacer', 'Escribir tests E2E');
  });

  await test.step('Beto no puede ver el tablero antes de ser invitado', async () => {
    const boardId = new URL(ana.url()).hash.slice(1);
    const res = await beto.request.get(`/api/boards/${boardId}`);
    expect(res.status()).toBe(404);
  });

  await test.step('Ana invita a Beto: le llega la invitación sin recargar y la acepta', async () => {
    await ana.getByRole('button', { name: 'Miembros' }).click();
    await ana.getByLabel('Invitar por correo').fill(users.beto.email);
    await ana.getByRole('button', { name: 'Invitar' }).click();
    // La invitación queda pendiente: Ana la ve en la lista, pero Beto todavía no es miembro.
    await expect(ana.locator('.members__pending').getByText(users.beto.email)).toBeVisible();

    const invitation = beto.locator('.invites__item').filter({ hasText: 'Sprint E2E' });
    await expect(invitation).toContainText('Ana te invitó');
    await invitation.getByRole('button', { name: 'Aceptar' }).click();
    await expect(beto.getByText('Escribir tests E2E')).toBeVisible();
    // Ahora Ana lo ve como miembro y ya no como pendiente.
    await expect(ana.locator('.members__list').getByText(users.beto.email)).toBeVisible();
    await expect(ana.locator('.members__pending')).toHaveCount(0);
  });

  await test.step('ambos se ven conectados', async () => {
    await expect(ana.getByText('En vivo · 2 conectados')).toBeVisible();
    await expect(beto.getByText('En vivo · 2 conectados')).toBeVisible();
  });

  await test.step('Beto (miembro) no tiene opciones de dueño', async () => {
    await expect(beto.getByRole('button', { name: 'Eliminar tablero' })).toHaveCount(0);
  });

  await test.step('lo que crea Beto le aparece a Ana', async () => {
    await addCard(beto, 'En progreso', 'Tarjeta de Beto');
    await expect(column(ana, 'En progreso').getByText('Tarjeta de Beto')).toBeVisible();
  });

  await test.step('Beto arrastra una tarjeta a Hecho y Ana lo ve', async () => {
    await drag(beto, beto.getByText('Escribir tests E2E'), column(beto, 'Hecho'));
    await expect(column(beto, 'Hecho').getByText('Escribir tests E2E')).toBeVisible();
    await expect(column(ana, 'Hecho').getByText('Escribir tests E2E')).toBeVisible();
    await expect(column(ana, 'Por hacer').getByText('Escribir tests E2E')).toHaveCount(0);
  });

  await test.step('Ana borra la tarjeta de Beto y a él le desaparece', async () => {
    await ana.getByRole('button', { name: 'Eliminar Tarjeta de Beto' }).click();
    await expect(beto.getByText('Tarjeta de Beto')).toHaveCount(0);
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

test('un miembro sale del tablero por su cuenta', async ({ browser }, info) => {
  test.skip(info.project.name === 'movil', 'cubierto en escritorio');
  const users = { ana: makeUser('Ana'), beto: makeUser('Beto') };
  const ana = await newUserPage(browser);
  const beto = await newUserPage(browser);
  await register(ana, users.ana);
  await register(beto, users.beto);
  await createBoard(ana, 'Para salir');
  await ana.getByRole('button', { name: 'Miembros' }).click();
  await ana.getByLabel('Invitar por correo').fill(users.beto.email);
  await ana.getByRole('button', { name: 'Invitar' }).click();
  await beto.getByRole('button', { name: 'Aceptar' }).click();
  await expect(beto.getByRole('heading', { name: 'Para salir' })).toBeVisible();

  beto.once('dialog', (d) => d.accept());
  await beto.getByRole('button', { name: 'Miembros' }).click();
  await beto.getByRole('button', { name: 'Salir del tablero' }).click();
  await expect(beto.getByText('Aún no tienes tableros')).toBeVisible();
  // Ana ve que ya no es miembro, sin recargar.
  await expect(ana.locator('.members__list').getByText(users.beto.email)).toHaveCount(0);
});

test('cerrar sesión en una pestaña la cierra en la otra', async ({ browser }) => {
  const u = makeUser('Sesion');
  const page1 = await newUserPage(browser);
  await register(page1, u);
  const page2 = await page1.context().newPage();
  await page2.goto('/');
  await expect(page2.getByText(u.name, { exact: true })).toBeVisible();

  await page1.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page1.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(page2.getByText('Se cerró tu sesión. Vuelve a iniciar sesión.')).toBeVisible();
  await expect(page2.getByRole('button', { name: 'Entrar' })).toBeVisible();
});
