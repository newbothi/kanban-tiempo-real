import { describe, expect, it } from 'vitest';
import { registerSchema } from '../src/schemas';

const base = { email: 'ana@correo.cl', name: 'Ana' };
const ok = (password: string) => registerSchema.safeParse({ ...base, password }).success;

describe('S-17: política de contraseñas', () => {
  it('cuenta bytes, no caracteres (bcrypt corta en 72 bytes)', () => {
    expect(ok('ñ'.repeat(36))).toBe(true); // 36 caracteres = 72 bytes
    expect(ok('ñ'.repeat(37))).toBe(false); // 37 caracteres = 74 bytes
    expect(ok('🔒'.repeat(19))).toBe(false); // 19 caracteres, 76 bytes: antes pasaba
  });

  it('rechaza contraseñas demasiado comunes, sin importar mayúsculas', () => {
    for (const p of ['12345678', 'Password1', 'contraseña', 'demo1234', 'QWERTYUIOP']) {
      expect(ok(p), p).toBe(false);
    }
  });

  it('acepta una contraseña razonable', () => {
    expect(ok('caballo-bateria-grapa')).toBe(true);
  });
});
