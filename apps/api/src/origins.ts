/**
 * Orígenes (otros sitios) desde los que se acepta usar la API con la cookie de sesión.
 *
 * En producción la web, la API y el WebSocket comparten origen, así que no hace falta
 * ninguno: si WEB_ORIGIN no está definido, la lista queda vacía (sin CORS). En desarrollo
 * el front corre en Vite (localhost:5173). Se pueden indicar varios separados por coma.
 */
export function allowedOrigins(): string[] {
  const configured = process.env.WEB_ORIGIN;
  if (configured) {
    return configured
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'];
}
