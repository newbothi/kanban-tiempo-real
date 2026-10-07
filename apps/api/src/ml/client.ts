import type { MlAnalysis, MlAnalyzeRequest } from '@kanban/shared';

export class MlUnavailableError extends Error {}

const TIMEOUT_MS = 20_000;

/**
 * Llama al servicio de análisis (Python). Node es el único que habla con él:
 * ya verificó los permisos y le manda solo los datos del tablero autorizado.
 */
export async function analyzeBoard(payload: MlAnalyzeRequest): Promise<MlAnalysis> {
  const base = process.env.ML_URL ?? 'http://localhost:8000';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.ML_TOKEN) headers['x-ml-token'] = process.env.ML_TOKEN;

  let res: Response;
  try {
    res = await fetch(`${base}/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new MlUnavailableError(`No se pudo contactar al servicio ML: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new MlUnavailableError(`El servicio ML respondió ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as MlAnalysis;
}
