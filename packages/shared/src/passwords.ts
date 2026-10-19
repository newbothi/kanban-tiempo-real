/**
 * Contraseñas demasiado comunes (S-17). Son las primeras que prueba cualquier ataque
 * de diccionario. La lista es corta a propósito: cubre lo más usado (incluido lo típico
 * en español) sin cargar un diccionario entero en el navegador.
 */
const COMMON = [
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234',
  '11223344', '12121212', '123123123', '1q2w3e4r', '1qaz2wsx', 'qwertyui', 'qwerty123',
  'qwertyuiop', 'asdfghjk', 'asdfasdf', 'zxcvbnm1', 'password', 'password1', 'password123',
  'passw0rd', 'p@ssw0rd', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball',
  'superman', 'starwars', 'whatever', 'trustno1', 'letmein1', 'welcome1', 'admin123',
  'administrador', 'contraseña', 'contrasena', 'contraseña1', 'contrasena1', 'clave123',
  'micontraseña', 'teamo123', 'tequiero', 'chile123', 'santiago', 'colocolo', 'universidad',
  'abcd1234', 'abc12345', 'demo1234', 'test1234', 'prueba123', 'kanban123', 'changeme',
  'qwerty12', 'q1w2e3r4', 'aaaaaaaa', 'abcdefgh', 'master12', 'dragon12', 'monkey12',
];

const COMMON_SET = new Set(COMMON);

export function isCommonPassword(password: string): boolean {
  return COMMON_SET.has(password.toLowerCase());
}

/** bcrypt solo usa los primeros 72 BYTES (no caracteres): una "ñ" o un emoji ocupan más de uno. */
export const MAX_PASSWORD_BYTES = 72;

export function passwordBytes(password: string): number {
  return new TextEncoder().encode(password).length;
}
