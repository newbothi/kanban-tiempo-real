import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeBoard, MlUnavailableError } from '../../src/ml/client';
import { fakeAnalysis } from '../ml-fixture';

const payload = { now: new Date().toISOString(), columns: [], cards: [], events: [] } as never;
const saved = { url: process.env.ML_URL, token: process.env.ML_TOKEN };

const reply = (body: string, init: ResponseInit = {}) => vi.fn().mockResolvedValue(new Response(body, init));

beforeEach(() => {
  process.env.ML_URL = 'http://ml.test';
  delete process.env.ML_TOKEN;
});
afterEach(() => {
  process.env.ML_URL = saved.url;
  if (saved.token === undefined) delete process.env.ML_TOKEN;
  else process.env.ML_TOKEN = saved.token;
  if (saved.url === undefined) delete process.env.ML_URL;
  vi.unstubAllGlobals();
});

describe('analyzeBoard: cliente del servicio ML', () => {
  it('manda el token si está configurado y devuelve la respuesta validada', async () => {
    process.env.ML_TOKEN = 't'.repeat(40);
    const fetchMock = reply(JSON.stringify(fakeAnalysis()), { status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const out = await analyzeBoard(payload);
    expect(out.summary).toBeDefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://ml.test/analyze');
    expect(init.headers['x-ml-token']).toBe('t'.repeat(40));
  });

  it('sin token no manda la cabecera', async () => {
    const fetchMock = reply(JSON.stringify(fakeAnalysis()), { status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await analyzeBoard(payload);
    expect(fetchMock.mock.calls[0]![1].headers).not.toHaveProperty('x-ml-token');
  });

  it('si no puede conectarse, lanza MlUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(analyzeBoard(payload)).rejects.toThrow(MlUnavailableError);
  });

  it('un error HTTP del servicio se informa recortado', async () => {
    vi.stubGlobal('fetch', reply('x'.repeat(5000), { status: 503 }));
    const err = (await analyzeBoard(payload).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(MlUnavailableError);
    expect(err.message.length).toBeLessThan(600);
  });

  it('rechaza respuestas que declaran ser enormes (S-19)', async () => {
    vi.stubGlobal('fetch', reply('{}', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }));
    await expect(analyzeBoard(payload)).rejects.toThrow('demasiado grande');
  });

  it('rechaza respuestas enormes aunque no declaren su tamaño', async () => {
    vi.stubGlobal('fetch', reply('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 }));
    await expect(analyzeBoard(payload)).rejects.toThrow('demasiado grande');
  });

  it('rechaza lo que no es JSON y lo que no cumple el formato', async () => {
    vi.stubGlobal('fetch', reply('<html>', { status: 200 }));
    await expect(analyzeBoard(payload)).rejects.toThrow('no es JSON');
    vi.stubGlobal('fetch', reply(JSON.stringify({ summary: 'no' }), { status: 200 }));
    await expect(analyzeBoard(payload)).rejects.toThrow('formato inesperado');
  });
});
