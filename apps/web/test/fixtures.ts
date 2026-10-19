import type { BoardDto, MlAnalysis, UserDto } from '@kanban/shared';

export const ana: UserDto = {
  id: 'u-ana',
  email: 'ana@ejemplo.cl',
  name: 'Ana',
  emailVerified: true,
  verificationRequired: false,
  isDemo: false,
};

export const beto: UserDto = { ...ana, id: 'u-beto', email: 'beto@ejemplo.cl', name: 'Beto' };

export function makeBoard(overrides: Partial<BoardDto> = {}): BoardDto {
  return {
    id: 'b-1',
    name: 'Proyecto',
    role: 'owner',
    columns: [
      { id: 'c-todo', boardId: 'b-1', title: 'Por hacer', position: 'a0' },
      { id: 'c-doing', boardId: 'b-1', title: 'En curso', position: 'a1' },
      { id: 'c-done', boardId: 'b-1', title: 'Hecho', position: 'a2' },
    ],
    cards: [
      { id: 'k-1', columnId: 'c-todo', title: 'Diseñar login', position: 'a0' },
      { id: 'k-2', columnId: 'c-todo', title: 'Escribir tests', position: 'a1' },
      { id: 'k-3', columnId: 'c-doing', title: 'Bug: drag en móvil', position: 'a0' },
    ],
    ...overrides,
  };
}

/** Un análisis completo del servicio ML, con todas las secciones. */
export function makeAnalysis(overrides: Partial<MlAnalysis> = {}): MlAnalysis {
  const week = (i: number) => new Date(Date.UTC(2026, 7, 3 + i * 7)).toISOString();
  return {
    generatedAt: '2026-10-19T12:00:00Z',
    summary: {
      cardsTotal: 30,
      backlog: 2,
      inProgress: 1,
      done: 27,
      doneLast4Weeks: 9,
      leadTimeMedianDays: 4.5,
      leadTimeP85Days: 9.2,
    },
    throughput: Array.from({ length: 8 }, (_, i) => ({ weekStart: week(i), done: 2 + (i % 3), trend: 2 + i * 0.2 })),
    trend: {
      slopePerWeek: 0.2,
      intercept: 2,
      r2: 0.61,
      pValue: 0.012,
      slopeCi95: [0.05, 0.35],
      direction: 'up',
    },
    forecast: {
      remaining: 3,
      simulations: 10000,
      weeksOfHistory: 8,
      p50: { weeks: 1, date: '2026-10-26T00:00:00Z' },
      p85: { weeks: 2, date: '2026-11-02T00:00:00Z' },
      p95: { weeks: 3, date: '2026-11-09T00:00:00Z' },
      histogram: [
        { weeks: 1, probability: 0.55 },
        { weeks: 2, probability: 0.3 },
        { weeks: 3, probability: 0.15 },
      ],
    },
    cycleTime: {
      nTrain: 27,
      bestModel: 'gradient_boosting',
      scores: [
        { name: 'baseline_median', maeDays: 3.1 },
        { name: 'linear_regression', maeDays: 2.4 },
        { name: 'gradient_boosting', maeDays: 1.9 },
      ],
      wipEffectDays: 0.8,
      kindEffectDays: { bug: 1.5, tarea: -0.7 },
      predictions: [
        { cardId: 'k-3', predictedLeadTimeDays: 6, elapsedDays: 8, remainingDays: 0, overdue: true },
        { cardId: 'k-1', predictedLeadTimeDays: 5, elapsedDays: 1, remainingDays: 4, overdue: false },
      ],
    },
    stale: [{ cardId: 'k-3', columnId: 'c-doing', daysInColumn: 8, typicalDays: 2, thresholdDays: 5 }],
    insights: ['Cada tarjeta adicional en progreso retrasa ~0,8 días.'],
    warnings: ['Hay pocas semanas de historial.'],
    ...overrides,
  };
}
