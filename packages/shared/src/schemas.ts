import { z } from 'zod';

// Validación de entrada. La API la usa para validar el body;
// el front la puede usar para validar formularios antes de enviar.

// Primero normaliza (quita espacios, minúsculas) y DESPUÉS valida el formato:
// así un correo pegado con un espacio al final no se rechaza.
const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Correo inválido'));

export const registerSchema = z.object({
  email,
  name: z.string().trim().min(1, 'Ingresa tu nombre').max(100),
  // bcrypt solo considera los primeros 72 bytes: limitamos para no dar una falsa sensación de seguridad.
  password: z.string().min(8, 'Mínimo 8 caracteres').max(72, 'Máximo 72 caracteres'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Ingresa tu contraseña').max(72),
});

export const addMemberSchema = z.object({ email });

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
