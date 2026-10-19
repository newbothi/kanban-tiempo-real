import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

/** Correos únicos por ejecución y por navegador: no hace falta limpiar la base entre corridas. */
export function makeUser(name: string): TestUser {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const project = test.info().project.name;
  return { name, email: `${name.toLowerCase()}-${project}-${run}@e2e.cl`, password: `clave-${name}-123`.toLowerCase() };
}

// S-11: la política CSP no debe romper nada. Cualquier recurso bloqueado se anota aquí
// y el test falla al final, con el detalle de lo que se bloqueó.
export const cspViolations: string[] = [];
export function watchCsp(page: Page) {
  const webkit = page.context().browser()?.browserType().name() === 'webkit';
  // El evento securitypolicyviolation trae qué directiva se violó y un trozo del contenido
  // bloqueado: con eso se sabe QUÉ lo causó, no solo que pasó.
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // WebKit + Playwright: en los contextos extra, el propio Playwright inyecta un <style>
      // inline (sin archivo de origen) que la CSP bloquea. La app no crea ningún <style>
      // (Chromium y Firefox, con los mismos flujos, no registran nada), así que esa firma
      // exacta se ignora. Cualquier otra violación sigue fallando el test.
      if (e.violatedDirective === 'style-src-elem' && e.blockedURI === 'inline' && !e.sourceFile) {
        console.debug('csp: <style> inline inyectado por el navegador de pruebas (ignorado)');
        return;
      }
      console.error(
        'Content Security Policy (detalle): ' +
          JSON.stringify({
            directiva: e.violatedDirective,
            bloqueado: e.blockedURI,
            muestra: e.sample,
            archivo: e.sourceFile,
            linea: e.lineNumber,
          }),
      );
    });
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error' || !/Content Security Policy/i.test(msg.text())) return;
    // El mismo caso de arriba, tal como lo informa la consola de WebKit (sin detalle).
    if (webkit && /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'/.test(msg.text())) return;
    const { url, lineNumber } = msg.location();
    cspViolations.push(`${msg.text()} (${url || page.url()}${lineNumber ? `:${lineNumber}` : ''})`);
  });
}
export function checkCspAfterEach() {
  test.beforeEach(({ page }) => watchCsp(page));
  test.afterEach(async () => {
    await Promise.all(extraContexts.splice(0).map((c) => c.close()));
    // Se vacía ANTES de comprobar: si no, un test que falla arrastraría sus violaciones al siguiente.
    const found = cspViolations.splice(0);
    expect(found, 'violaciones de CSP en el navegador').toEqual([]);
  });
}

const extraContexts: BrowserContext[] = [];

/**
 * Cada usuario en su propio contexto = como si fueran dos navegadores distintos.
 * (Playwright Test le aplica al contexto las opciones del proyecto: baseURL, dispositivo…)
 * Se cierran al terminar cada test, para que nada de un test siga corriendo en el siguiente.
 */
export async function newUserPage(browser: Browser) {
  const context = await browser.newContext();
  extraContexts.push(context);
  const page = await context.newPage();
  watchCsp(page);
  return page;
}

export async function register(page: Page, u: TestUser) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Nombre').fill(u.name);
  await page.getByLabel('Correo').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).last().click();
  await expect(page.getByText(u.name, { exact: true })).toBeVisible();
}

export async function createBoard(page: Page, name: string) {
  await page.getByLabel('Nombre del nuevo tablero').fill(name);
  await page.getByLabel('Nombre del nuevo tablero').press('Enter');
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

export async function addCard(page: Page, columnTitle: string, title: string) {
  const input = page.getByLabel(`Nueva tarjeta en ${columnTitle}`);
  await input.fill(title);
  await input.press('Enter');
  await expect(column(page, columnTitle).getByText(title)).toBeVisible();
}

export const column = (page: Page, title: string) =>
  page.locator('section.column').filter({ has: page.getByRole('heading', { name: title }) });

/** Arrastre "humano" (dnd-kit necesita movimiento real del puntero, no un drop instantáneo). */
export async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 30, { steps: 15 });
  await page.mouse.up();
}

/**
 * Accesibilidad con axe (WCAG 2.1 A y AA). Falla con cualquier problema serio o crítico y
 * deja el reporte completo adjunto al test (en el reporte HTML del CI).
 */
export async function expectAccessible(page: Page, screen: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  await test.info().attach(`axe-${screen}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(serious, `axe en «${screen}»`).toEqual([]);
}
