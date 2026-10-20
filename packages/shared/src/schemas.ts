import { z } from 'zod';
import { MAX_PASSWORD_BYTES, isCommonPassword, passwordBytes } from './passwords';

// Validación de entrada. La API la usa para validar el body;
// el front la puede usar para validar formularios antes de enviar.

/**
 * En el navegador, Zod 4 prueba si puede usar `new Function` para validar más rápido. Con
 * nuestra CSP (script-src 'self', sin 'unsafe-eval') no puede, y el intento queda registrado
 * como violación de CSP aunque falle en silencio. En modo jitless no lo intenta.
 * Tiene que ir ANTES de definir los schemas: Zod decide al crearlos, no al validar.
 * En el servidor (sin `document`) se mantiene la compilación, que es más rápida.
 */
if (typeof document !== 'undefined') z.config({ jitless: true });

// Primero normaliza (quita espacios, minúsculas) y DESPUÉS valida el formato:
// así un correo pegado con un espacio al final no se rechaza.
const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Correo inválido'));

export const registerSchema = z.object({
  email,
  name: z.string().trim().min(1, 'Ingresa tu nombre').max(100),
  // bcrypt solo considera los primeros 72 BYTES: limitamos para no dar una falsa sensación de seguridad.
  password: z
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .refine((p) => passwordBytes(p) <= MAX_PASSWORD_BYTES, 'Demasiado larga (máximo 72 bytes)')
    .refine((p) => !isCommonPassword(p), 'Esa contraseña es demasiado común; elige otra'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Ingresa tu contraseña').max(256),
});

export const addMemberSchema = z.object({ email });

/** Token del enlace de invitación que llega por correo. */
export const claimInviteSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Enlace inválido') });

export const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const createCardSchema = z.object({
  columnId: z.uuid(),
  title: z.string().trim().min(1).max(500),
});

export const renameCardSchema = z.object({
  title: z.string().trim().min(1).max(500),
});

/** Mover = "deja la tarjeta en esta columna, en este índice". El servidor calcula la position. */
export const moveCardSchema = z.object({
  columnId: z.uuid(),
  index: z.number().int().min(0),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type CreateCardInput = z.infer<typeof createCardSchema>;
export type RenameCardInput = z.infer<typeof renameCardSchema>;
export type MoveCardInput = z.infer<typeof moveCardSchema>;
