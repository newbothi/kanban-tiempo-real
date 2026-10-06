import { describe, expect, it } from 'vitest';
import { loginSchema, moveCardSchema, registerSchema } from '../src/schemas';

describe('registerSchema', () => {
  const ok = { email: '  Ana@Correo.CL ', name: ' Ana ', password: 'secreta123' };

  it('normaliza el correo (trim + minúsculas) y el nombre', () => {
    expect(registerSchema.parse(ok)).toMatchObject({ email: 'ana@correo.cl', name: 'Ana' });
  });

  it.each([
    ['correo inválido', { ...ok, email: 'no-es-correo' }],
    ['contraseña corta', { ...ok, password: '1234567' }],
    ['contraseña > 72 (límite de bcrypt)', { ...ok, password: 'x'.repeat(73) }],
    ['nombre vacío', { ...ok, name: '   ' }],
  ])('rechaza %s', (_, input) => {
    expect(registerSchema.safeParse(input).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('exige contraseña', () => {
    expect(loginSchema.safeParse({ email: 'a@b.cl', password: '' }).success).toBe(false);
  });
});

describe('moveCardSchema', () => {
  it.each([
    ['índice negativo', { columnId: crypto.randomUUID(), index: -1 }],
    ['índice decimal', { columnId: crypto.randomUUID(), index: 1.5 }],
    ['columnId que no es uuid', { columnId: '1; DROP TABLE Card', index: 0 }],
  ])('rechaza %s', (_, input) => {
    expect(moveCardSchema.safeParse(input).success).toBe(false);
  });
});
