import { vi } from 'vitest';

/**
 * API falsa: reemplaza `fetch` y responde según una tabla de rutas ("GET /boards").
 * Cada handler recibe el cuerpo (ya parseado) y la URL; devuelve el JSON de respuesta o
 * `reply(status, body)` para otro código. Las rutas sin handler responden 404.
 */
export interface Reply {
  __reply: true;
  status: number;
  body?: unknown;
}
export const reply = (status: number, body?: unknown): Reply => ({ __reply: true, status, body });

type Handler = (body: unknown, url: URL) => unknown | Promise<unknown>;
export interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export function installApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, headers: (init.headers ?? {}) as Record<string, string> });

    const key = Object.keys(routes).find((k) => {
      const [m, pattern] = k.split(' ');
      if (m !== method) return false;
      const re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, '[^/]+') + '$');
      return re.test(path);
    });
    if (!key) return json(404, { message: `Ruta no simulada: ${method} ${path}` });
    const out = await routes[key](body, url);
    if (out && typeof out === 'object' && '__reply' in out) {
      const r = out as Reply;
      return r.status === 204 ? new Response(null, { status: 204 }) : json(r.status, r.body);
    }
    return out === undefined ? new Response(null, { status: 204 }) : json(200, out);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    /** Llamadas a una ruta ("POST /cards"). */
    callsTo: (route: string) => {
      const [m, p] = route.split(' ');
      return calls.filter((c) => c.method === m && c.path === p);
    },
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
