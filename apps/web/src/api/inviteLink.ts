/**
 * El correo de invitación abre la app con ?invitacion=<token>. El token se queda en la URL
 * hasta que la persona inicia sesión (o crea su cuenta) y la app lo reclama.
 */
const PARAM = 'invitacion';

export function inviteTokenFromUrl(): string | null {
  const token = new URLSearchParams(location.search).get(PARAM);
  if (token == "") return null;
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function clearInviteToken() {
  const params = new URLSearchParams(location.search);
  params.delete(PARAM);
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
}
