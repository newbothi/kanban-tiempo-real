/**
 * Prueba de carga (fase 4) contra las imágenes Docker reales, en el CI.
 *
 * - "mover": 50 personas moviendo tarjetas a la vez durante 1 minuto, en 10 tableros
 *   compartidos de a 5 (así también hay contención en las mismas columnas).
 * - "metricas": 10 personas pidiendo /metrics cada segundo. La API cachea el análisis y
 *   limita los cálculos por persona: 200 y 429 son respuestas esperadas; 5xx no.
 *
 * Cada persona virtual usa su propia IP en X-Forwarded-For: en Azure esa cabecera la pone el
 * proxy de entrada, y la API confía en ese único salto (S-02). Sin esto, los 50 registros
 * chocarían con el límite de /auth por IP.
 */
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';

const API = __ENV.API_URL || 'http://127.0.0.1:3000';
const USERS = 50;
const PER_BOARD = 5;
const CARDS_PER_BOARD = 20;

export const options = {
  setupTimeout: '3m',
  scenarios: {
    mover: { executor: 'constant-vus', vus: USERS, duration: '60s', exec: 'mover' },
    metricas: { executor: 'constant-vus', vus: 10, duration: '60s', exec: 'metricas' },
  },
  thresholds: {
    'http_req_failed{scenario:mover}': ['rate<0.01'],
    'http_req_duration{scenario:mover}': ['p(95)<1500'],
    'http_req_failed{scenario:metricas}': ['rate<0.01'],
    'http_req_duration{scenario:metricas}': ['p(95)<3000'],
    // Que los escenarios de verdad hayan corrido (una excepción en el script no hace fallar a k6).
    'http_reqs{scenario:mover}': ['count>1000'],
    'http_reqs{scenario:metricas}': ['count>300'],
    checks: ['rate>0.99'],
  },
};

const ip = (i) => `10.${Math.floor(i / 250)}.${i % 250}.${1 + (i % 200)}`;
const json = (cookie, i) => ({
  headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': ip(i) },
});
/** Para POST sin cuerpo: sin content-type (con JSON vacío la API responde 400, como debe). */
const noBody = (cookie, i) => ({ headers: { cookie, 'x-forwarded-for': ip(i) } });

/** Registra a las 50 personas, arma 10 tableros con 5 miembros y 20 tarjetas cada uno. */
export function setup() {
  const run = Date.now().toString(36);
  const users = [];
  for (let i = 0; i < USERS; i++) {
    const email = `k6-${run}-${i}@carga.cl`;
    const r = http.post(
      `${API}/api/auth/register`,
      JSON.stringify({ email, name: `Carga ${i}`, password: 'una frase de carga bastante larga' }),
      json('', i),
    );
    if (r.status !== 201) fail(`registro ${i}: ${r.status} ${r.body}`);
    // La API está en modo producción (cookie Secure): se maneja la cookie a mano.
    const cookie = String(r.headers['Set-Cookie']).split(';')[0];
    users.push({ i, email, cookie });
  }

  const boards = [];
  for (let b = 0; b < USERS / PER_BOARD; b++) {
    const owner = users[b * PER_BOARD];
    const board = http.post(`${API}/api/boards`, JSON.stringify({ name: `Carga ${b}` }), json(owner.cookie, owner.i)).json();
    const full = http.get(`${API}/api/boards/${board.id}`, json(owner.cookie, owner.i)).json();
    const cols = full.columns.map((c) => c.id);
    for (let m = 1; m < PER_BOARD; m++) {
      const member = users[b * PER_BOARD + m];
      http.post(`${API}/api/boards/${board.id}/members`, JSON.stringify({ email: member.email }), json(owner.cookie, owner.i));
      const inv = http.get(`${API}/api/invites`, json(member.cookie, member.i)).json()[0];
      const a = http.post(`${API}/api/invites/${inv.id}/accept`, null, noBody(member.cookie, member.i));
      if (a.status !== 204) fail(`aceptar invitación: ${a.status} ${a.body}`);
    }
    const cards = [];
    for (let c = 0; c < CARDS_PER_BOARD; c++) {
      const r = http.post(`${API}/api/cards`, JSON.stringify({ columnId: cols[c % cols.length], title: `Tarea ${c}` }), json(owner.cookie, owner.i));
      cards.push(r.json('id'));
    }
    boards.push({ id: board.id, cols, cards });
  }
  return { users, boards };
}

export function mover(data) {
  const u = data.users[(__VU - 1) % USERS];
  const board = data.boards[Math.floor(u.i / PER_BOARD)];
  const card = board.cards[Math.floor(Math.random() * board.cards.length)];
  const columnId = board.cols[Math.floor(Math.random() * board.cols.length)];
  const r = http.post(
    `${API}/api/cards/${card}/move`,
    JSON.stringify({ columnId, index: Math.floor(Math.random() * 6) }),
    Object.assign(json(u.cookie, u.i), { tags: { name: 'mover tarjeta' } }),
  );
  check(r, { 'mover → 200': (res) => res.status === 200 });
  if (Math.random() < 0.2) {
    const g = http.get(`${API}/api/boards/${board.id}`, Object.assign(json(u.cookie, u.i), { tags: { name: 'ver tablero' } }));
    check(g, { 'tablero → 200': (res) => res.status === 200 });
  }
  sleep(0.6 + Math.random() * 0.4); // ~1 movimiento por segundo: bajo el tope de 120 escrituras/min
}

const metricsOk = http.expectedStatuses(200, 429);

export function metricas(data) {
  // Los ids de VU son globales (los de este escenario no parten en 1): se usa el módulo.
  const b = (exec.vu.idInTest - 1) % data.boards.length;
  const u = data.users[b * PER_BOARD]; // los dueños de los tableros
  const board = data.boards[b];
  const r = http.get(
    `${API}/api/boards/${board.id}/metrics`,
    Object.assign(json(u.cookie, u.i), { responseCallback: metricsOk, tags: { name: 'métricas' } }),
  );
  check(r, { 'métricas → 200 o 429 (límite por persona)': (res) => res.status === 200 || res.status === 429 });
  sleep(1);
}

export function handleSummary(data) {
  const m = data.metrics;
  const fmt = (x) => (x === undefined ? '—' : Math.round(x));
  const line = (s) =>
    `p95 ${fmt(m[`http_req_duration{scenario:${s}}`]?.values['p(95)'])} ms · ` +
    `errores ${((m[`http_req_failed{scenario:${s}}`]?.values.rate ?? 0) * 100).toFixed(2)} %`;
  const text =
    `Carga: ${m.http_reqs.values.count} peticiones (${m.http_reqs.values.rate.toFixed(1)}/s)\n` +
    `  mover tarjetas (50 personas): ${line('mover')}\n` +
    `  métricas (10 personas):       ${line('metricas')}\n` +
    `  checks OK: ${(m.checks.values.rate * 100).toFixed(2)} %\n`;
  return { stdout: text, 'k6-resumen.json': JSON.stringify(data, null, 2), 'k6-resumen.txt': text };
}
