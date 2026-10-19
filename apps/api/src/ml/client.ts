import type { MlAnalysis, MlAnalyzeRequest } from '@kanban/shared';
import { mlAnalysisSchema } from './response';

export class MlUnavailableError extends Error {}

const TIMEOUT_MS = 20_000;
/** Una respuesta real pesa decenas de KB; más que esto es un error o un abuso (S-19). */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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
    const detail = (await res.text()).slice(0, 500);
    throw new MlUnavailableError(`El servicio ML respondió ${res.status}: ${detail}`);
  }

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new MlUnavailableError('Respuesta del servicio ML demasiado grande');
  const body = await res.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new MlUnavailableError('Respuesta del servicio ML demasiado grande');

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new MlUnavailableError('El servicio ML respondió algo que no es JSON');
  }
  const parsed = mlAnalysisSchema.safeParse(json);
  if (!parsed.success) {
    throw new MlUnavailableError(`Respuesta del servicio ML con formato inesperado: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data as MlAnalysis;
}
