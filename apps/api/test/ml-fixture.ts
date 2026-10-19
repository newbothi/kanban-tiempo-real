/** Respuesta mínima VÁLIDA del servicio ML (Node la valida antes de reenviarla, S-19). */
export function fakeAnalysis(insights: string[] = []) {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      cardsTotal: 0,
      backlog: 0,
      inProgress: 0,
      done: 0,
      doneLast4Weeks: 0,
      leadTimeMedianDays: null,
      leadTimeP85Days: null,
    },
    throughput: [],
    trend: null,
    forecast: null,
    cycleTime: null,
    stale: [],
    insights,
    warnings: [],
  };
}
