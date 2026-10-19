import { describe, expect, it } from 'vitest';
import { mlAnalysisSchema } from '../../src/ml/response';
import { fakeAnalysis } from '../ml-fixture';

describe('S-19: validación de la respuesta del ML', () => {
  it('acepta una respuesta válida y descarta campos desconocidos', () => {
    const r = mlAnalysisSchema.safeParse({ ...fakeAnalysis(['hola']), extra: 'x' });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).extra).toBeUndefined();
  });

  it('rechaza tipos incorrectos', () => {
    expect(mlAnalysisSchema.safeParse({ ...fakeAnalysis(), insights: 'texto' }).success).toBe(false);
    expect(mlAnalysisSchema.safeParse({ ...fakeAnalysis(), summary: null }).success).toBe(false);
  });

  it('rechaza listas absurdamente grandes', () => {
    const many = Array.from({ length: 51 }, () => 'x');
    expect(mlAnalysisSchema.safeParse({ ...fakeAnalysis(), insights: many }).success).toBe(false);
  });
});
