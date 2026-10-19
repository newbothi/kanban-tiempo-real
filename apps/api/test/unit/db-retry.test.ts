import { describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ??= 'sqlserver://localhost:1;database=sin_bd_test';
const { isConflict, retryOnConflict } = await import('../../src/db');

const deadlock = () => Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' });

describe('retryOnConflict: deadlocks de SQL Server', () => {
  it('reintenta a la víctima de un deadlock y devuelve el resultado', async () => {
    const run = vi.fn().mockRejectedValueOnce(deadlock()).mockRejectedValueOnce(deadlock()).mockResolvedValue('ok');
    await expect(retryOnConflict(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('se rinde tras los intentos indicados y deja pasar el error (el handler responde 503)', async () => {
    const run = vi.fn().mockRejectedValue(deadlock());
    await expect(retryOnConflict(run, 3)).rejects.toMatchObject({ code: 'P2034' });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('no reintenta otros errores (p. ej. un correo duplicado)', async () => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    await expect(retryOnConflict(run)).rejects.toMatchObject({ code: 'P2002' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reconoce los conflictos por código o por mensaje', () => {
    expect(isConflict({ code: 'P2028' })).toBe(true);
    expect(isConflict(new Error('Transaction (Process ID 52) was deadlocked … error 1205'))).toBe(true);
    expect(isConflict(new Error('otra cosa'))).toBe(false);
    expect(isConflict(undefined)).toBe(false);
  });
});
