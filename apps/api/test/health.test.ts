import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const saved = process.env.APP_VERSION;

beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  if (saved === undefined) delete process.env.APP_VERSION;
  else process.env.APP_VERSION = saved;
  await server.app.close();
});

describe('/health', () => {
  it('confirma que llega a la base e informa el commit de la imagen (lo usa el despliegue)', async () => {
    process.env.APP_VERSION = 'abc123';
    const r = await fetch(`${server.base}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: 'abc123' });
  });

  it('sin versión de imagen (desarrollo) responde "dev"', async () => {
    delete process.env.APP_VERSION;
    expect(await (await fetch(`${server.base}/health`)).json()).toEqual({ ok: true, version: 'dev' });
  });
});
