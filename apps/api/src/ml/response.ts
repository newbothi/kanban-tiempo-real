import { z } from 'zod';
import type { MlAnalysis } from '@kanban/shared';

/**
 * Esquema de la respuesta del servicio ML (S-19). Node no reenvía al navegador lo que
 * llegue sin revisarlo: si el servicio falla, se configura mal o lo comprometen, una
 * respuesta con otra forma se trata como "servicio no disponible". Además, Zod descarta
 * los campos que no conoce, así que solo viaja lo que la interfaz espera.
 * Debe coincidir con AnalyzeResponse en apps/ml/app/schemas.py.
 */
const num = z.number().finite();
const int = z.number().int();
const date = z.string().max(40);
const text = z.string().max(2_000);
const modelName = z.enum(['baseline_median', 'linear_regression', 'gradient_boosting']);

const point = z.object({ weeks: int, date });

export const mlAnalysisSchema = z.object({
  generatedAt: date,
  summary: z.object({
    cardsTotal: int,
    backlog: int,
    inProgress: int,
    done: int,
    doneLast4Weeks: int,
    leadTimeMedianDays: num.nullable(),
    leadTimeP85Days: num.nullable(),
  }),
  throughput: z.array(z.object({ weekStart: date, done: int, trend: num.nullable() })).max(60),
  trend: z
    .object({
      slopePerWeek: num,
      intercept: num,
      r2: num,
      pValue: num,
      slopeCi95: z.tuple([num, num]),
      direction: z.enum(['up', 'down', 'flat']),
    })
    .nullable(),
  forecast: z
    .object({
      remaining: int,
      simulations: int,
      weeksOfHistory: int,
      p50: point,
      p85: point,
      p95: point,
      histogram: z.array(z.object({ weeks: int, probability: num })).max(600),
    })
    .nullable(),
  cycleTime: z
    .object({
      nTrain: int,
      bestModel: modelName,
      scores: z.array(z.object({ name: modelName, maeDays: num })).max(10),
      wipEffectDays: num,
      kindEffectDays: z.record(z.string().max(40), num),
      predictions: z
        .array(
          z.object({
            cardId: z.string().max(64),
            predictedLeadTimeDays: num,
            elapsedDays: num,
            remainingDays: num,
            overdue: z.boolean(),
          }),
        )
        .max(5_000),
    })
    .nullable(),
  stale: z
    .array(
      z.object({
        cardId: z.string().max(64),
        columnId: z.string().max(64),
        daysInColumn: num,
        typicalDays: num,
        thresholdDays: num,
      }),
    )
    .max(5_000),
  insights: z.array(text).max(50),
  warnings: z.array(text).max(50),
});

// Si el contrato generado desde Python cambia y este esquema no, TypeScript avisa aquí.
type Parsed = z.infer<typeof mlAnalysisSchema>;
export const _contractCheck = (p: Parsed): MlAnalysis => p;
