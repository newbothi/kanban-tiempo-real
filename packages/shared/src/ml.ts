// Tipos del servicio de análisis (Python), GENERADOS desde su OpenAPI.
// No edites ml-api.ts a mano: corre `npm run ml:types -w @kanban/shared`.
import type { components } from './ml-api';

type S = components['schemas'];

export type MlAnalyzeRequest = S['AnalyzeRequest'];
export type MlAnalysis = S['AnalyzeResponse'];
export type MlSummary = S['Summary'];
export type MlWeekPoint = S['WeekPoint'];
export type MlTrend = S['Trend'];
export type MlForecast = S['Forecast'];
export type MlCycleTime = S['CycleTime'];
export type MlCardPrediction = S['CardPrediction'];
export type MlStaleCard = S['StaleCard'];
