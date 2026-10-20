import { expect, test } from '@playwright/test';
import { addCard, checkCspAfterEach, createBoard, expectAccessible, makeUser, register } from './helpers.ts';

checkCspAfterEach();

test('accesibilidad (axe) en cada pantalla', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expectAccessible(page, 'login');

  await page.getByRole('tab', { name: 'Crear cuenta' }).click();
  await expectAccessible(page, 'registro');

  await register(page, makeUser('Axe'));
  await expect(page.getByText('Aún no tienes tableros')).toBeVisible();
  await expectAccessible(page, 'sin tableros');

  await createBoard(page, 'Accesible');
  await addCard(page, 'Por hacer', 'Una tarjeta');
  await expectAccessible(page, 'tablero');

  await page.getByRole('button', { name: 'Miembros' }).click();
  await expect(page.getByLabel('Invitar por correo')).toBeVisible();
  await expectAccessible(page, 'miembros');

  await page.getByRole('tab', { name: 'Métricas' }).click();
  await expect(
    page.getByRole('heading', { name: /Ritmo del equipo|El servicio de análisis no está disponible|métricas/ }),
  ).toBeVisible();
  await expectAccessible(page, 'métricas');
});

test('en el móvil se puede usar todo sin scroll horizontal', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'solo en el viewport móvil');
  await register(page, makeUser('Movil'));
  await createBoard(page, 'Desde el teléfono');
  await addCard(page, 'Por hacer', 'Tarjeta móvil');
  await addCard(page, 'Hecho', 'Otra tarjeta');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'la página no debe tener scroll horizontal').toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Miembros' }).click();
  await expect(page.getByLabel('Invitar por correo')).toBeVisible();
  await page.getByRole('tab', { name: 'Métricas' }).click();
  await expect(page.getByRole('tab', { name: 'Métricas' })).toHaveAttribute('aria-selected', 'true');
  const overflowMetrics = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflowMetrics, 'métricas sin scroll horizontal').toBeLessThanOrEqual(0);

  await page.getByRole('tab', { name: 'Tablero' }).click();
  await page.getByRole('button', { name: 'Eliminar Tarjeta móvil' }).click();
  await expect(page.getByText('Tarjeta móvil')).toHaveCount(0);
});
