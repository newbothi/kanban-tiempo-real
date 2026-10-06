import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { SESSION_COOKIE, type ClientToServerEvents, type ServerToClientEvents } from '@kanban/shared';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';

/** Borra todos los datos (en orden por las claves foráneas). */
export async function resetDb() {
  await prisma.card.deleteMany();
  await prisma.column.deleteMany();
  await prisma.boardMember.deleteMany();
  await prisma.board.deleteMany();
  await prisma.user.deleteMany();
}

/** Levanta la API en un puerto libre. */
export async function startServer(opts: { authRateLimit?: number } = {}) {
  const app = await buildApp({ logger: false, authRateLimit: opts.authRateLimit ?? 1000 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}` };
}

/** Cliente HTTP que guarda la cookie de sesión, como haría un navegador. */
export function httpClient(base: string) {
  let cookie = '';
  async function req<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie?.startsWith(SESSION_COOKIE + '=')) {
      const pair = setCookie.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair; // cookie vacía = logout
    }
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T, setCookie };
  }
  return {
    req,
    get cookie() {
      return cookie;
    },
  };
}

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents> & {
  events: [string, any][];
};

/** Socket autenticado con la cookie del cliente; guarda todos los eventos que recibe. */
export function socketFor(base: string, cookie: string): TestSocket {
  const s = io(base, {
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
    forceNew: true,
  }) as TestSocket;
  s.events = [];
  s.onAny((ev, payload) => s.events.push([ev, payload]));
  return s;
}

export const connected = (s: Socket) =>
  new Promise<string>((resolve) => {
    if (s.connected) return resolve('ok');
    s.once('connect', () => resolve('ok'));
    s.once('connect_error', (e) => resolve('error:' + e.message));
  });

export const joinBoard = (s: TestSocket, boardId: string) =>
  new Promise<{ ok: boolean; error?: string }>((resolve) => s.emit('board:join', boardId, resolve));

/** Espera hasta que llegue un evento que cumpla la condición (o falla tras `ms`). */
export function waitForEvent(s: TestSocket, name: string, match: (p: any) => boolean = () => true, ms = 2000) {
  return new Promise<any>((resolve, reject) => {
    const found = s.events.find(([e, p]) => e === name && match(p));
    if (found) return resolve(found[1]);
    const timer = setTimeout(() => {
      s.offAny(handler);
      reject(new Error(`No llegó el evento "${name}" en ${ms} ms`));
    }, ms);
    const handler = (e: string, p: any) => {
      if (e === name && match(p)) {
        clearTimeout(timer);
        s.offAny(handler);
        resolve(p);
      }
    };
    s.onAny(handler);
  });
}

/** Comprueba que NO llegue un evento durante `ms`. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Registra un usuario y devuelve su cliente con sesión. */
export async function registerUser(base: string, name: string) {
  const c = httpClient(base);
  const email = `${name.toLowerCase()}@test.cl`;
  const r = await c.req('POST', '/auth/register', { email, name, password: 'clave-segura-123' });
  if (r.status !== 201) throw new Error(`registro falló: ${r.status} ${JSON.stringify(r.data)}`);
  return Object.assign(c, { id: r.data.id as string, email });
}

export { prisma };
