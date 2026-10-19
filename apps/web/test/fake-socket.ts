/**
 * Socket.IO falso para los tests: guarda lo que la app emite y permite simular
 * los eventos que mandaría el servidor (`serverEmit`).
 */
type Handler = (...args: unknown[]) => void;

export class FakeSocket {
  connected = false;
  active = false;
  id: string | undefined = 'socket-de-prueba';
  emitted: [string, unknown[]][] = [];
  /** Respuesta del servidor a `board:join`. */
  joinReply: { ok: boolean; error?: string } = { ok: true };
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    this.emitted.push([event, args]);
    const ack = args.at(-1);
    if (event === 'board:join' && typeof ack === 'function') ack(this.joinReply);
    return this;
  }

  connect() {
    this.active = true;
    this.connected = true;
    this.serverEmit('connect');
    return this;
  }

  disconnect() {
    const was = this.connected;
    this.active = false;
    this.connected = false;
    if (was) this.serverEmit('disconnect', 'io client disconnect');
    return this;
  }

  /** Simula un evento enviado por el servidor. */
  serverEmit(event: string, ...args: unknown[]) {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args);
  }

  /** Simula que se cae la conexión (sin que la app la haya cerrado). */
  drop() {
    this.connected = false;
    this.serverEmit('disconnect', 'transport close');
  }

  listeners(event: string) {
    return this.handlers.get(event)?.size ?? 0;
  }

  emittedNames() {
    return this.emitted.map(([e]) => e);
  }

  reset() {
    this.connected = false;
    this.active = false;
    this.emitted = [];
    this.joinReply = { ok: true };
    this.handlers.clear();
  }
}

export const fakeSocket = new FakeSocket();
