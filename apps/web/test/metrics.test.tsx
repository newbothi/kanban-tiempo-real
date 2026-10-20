import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client';
import { fmtDays, niceMax } from '../src/components/metrics/format';
import { MetricsView } from '../src/components/metrics/MetricsView';
import { installApi } from './fake-api';
import { ana, makeAnalysis, makeBoard } from './fixtures';
import { renderApp } from './render';

const board = makeBoard();
const view = (props: Partial<Parameters<typeof MetricsView>[0]> = {}) =>
  render(<MetricsView board={board} data={makeAnalysis()} error={null} isFetching={false} {...props} />);

describe('vista de métricas', () => {
  it('resume el tablero: entregas, tiempo típico, pendientes y fecha estimada', () => {
    view();
    expect(screen.getByText('Terminadas en las últimas 4 semanas').nextSibling).toHaveTextContent('9');
    expect(screen.getByText('4,5 días')).toBeInTheDocument();
    expect(screen.getByText('85% en ≤ 9,2 días')).toBeInTheDocument();
    expect(screen.getByText('2 por hacer · 1 en curso')).toBeInTheDocument();
    expect(screen.getByText('2 semanas')).toBeInTheDocument();
  });

  it('muestra conclusiones, avisos y la tendencia con su significancia', () => {
    view();
    expect(screen.getByText('Cada tarjeta adicional en progreso retrasa ~0,8 días.')).toBeInTheDocument();
    expect(screen.getByText('Hay pocas semanas de historial.')).toBeInTheDocument();
    expect(screen.getByText(/Pendiente \+0,20 tarjetas\/semana por semana · IC 95% \[0,05; 0,35\]/)).toBeInTheDocument();
  });

  it('una pendiente no significativa se explica como ritmo estable', () => {
    const data = makeAnalysis();
    data.trend = { ...data.trend!, direction: 'flat', pValue: 0.4 };
    view({ data });
    expect(screen.getByText(/no significativa \(p = 0,40\): el ritmo es estable/)).toBeInTheDocument();
  });

  it('marca el mejor modelo y los efectos de la regresión', () => {
    view();
    const best = screen.getByText('mejor').closest('.models__row') as HTMLElement;
    expect(within(best).getByText('Gradient boosting')).toBeInTheDocument();
    expect(screen.getByText('+1,5 días')).toBeInTheDocument();
    expect(screen.getByText('−0,7 días')).toBeInTheDocument();
  });

  it('la tabla de predicción pone primero lo atrasado y deja al final lo que está en cola', () => {
    view();
    const rows = screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows[0]).toContain('Bug: drag en móvil');
    expect(rows[0]).toContain('⏱ Atrasada');
    expect(rows[1]).toContain('Diseñar login');
    expect(rows[1]).toContain('En cola');
  });

  it('lista las tarjetas estancadas con su umbral', () => {
    view();
    expect(screen.getByText(/lleva 8,0 días en En curso/)).toBeInTheDocument();
    expect(screen.getByText(/umbral 5,0 días/)).toBeInTheDocument();
  });

  it('sin historial suficiente lo dice en vez de inventar', () => {
    view({
      data: makeAnalysis({ trend: null, forecast: null, cycleTime: null, stale: [], throughput: [], insights: [], warnings: [] }),
    });
    expect(screen.getByText(/al menos 4 semanas de actividad/)).toBeInTheDocument();
    expect(screen.getByText('Falta historial')).toBeInTheDocument();
    expect(screen.getByText(/Ninguna tarjeta en curso supera/)).toBeInTheDocument();
    expect(screen.getByText('Sin datos aún.')).toBeInTheDocument();
  });

  it('si el servicio ML está caído (503) lo explica sin datos técnicos', () => {
    view({ data: undefined, error: new ApiError(503, 'ML caído') });
    expect(screen.getByText('El servicio de análisis no está disponible')).toBeInTheDocument();
    expect(screen.queryByText('ML caído')).not.toBeInTheDocument();
  });

  it('otro error muestra su mensaje', () => {
    view({ data: undefined, error: new ApiError(429, 'Demasiados cálculos de métricas') });
    expect(screen.getByText('Demasiados cálculos de métricas')).toBeInTheDocument();
  });

  it('al recalcular mantiene el análisis anterior y lo avisa, sin atenuar el texto', () => {
    const { container } = view({ isFetching: true });
    expect(screen.getByRole('status')).toHaveTextContent('Actualizando el análisis…');
    expect(container.querySelector('.metrics')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Terminadas en las últimas 4 semanas')).toBeInTheDocument();
  });

  it('mientras calcula, lo indica', () => {
    view({ data: undefined });
    expect(screen.getByText('Analizando el tablero…')).toBeInTheDocument();
  });

  it('los gráficos tienen alternativa en tabla y tooltip al pasar el puntero', async () => {
    view();
    const user = userEvent.setup();
    const bars = screen.getAllByLabelText(/^Semana del .*: \d+ terminadas$/);
    expect(bars).toHaveLength(8);
    fireEvent.pointerEnter(bars[0]);
    expect(screen.getByText('2 terminadas')).toBeInTheDocument();
    fireEvent.pointerLeave(bars[0]);
    expect(screen.queryByText('2 terminadas')).not.toBeInTheDocument();

    const twoWeeks = screen.getByLabelText('2 semanas: 30%');
    fireEvent.pointerEnter(twoWeeks);
    expect(screen.getByText('de terminar en 2 semanas')).toBeInTheDocument();
    expect(screen.getByText('85% de terminar en 2 o menos')).toBeInTheDocument();
    fireEvent.blur(twoWeeks);
    expect(screen.queryByText('de terminar en 2 semanas')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText('1 semana: 55%')); // también con teclado
    expect(screen.getByText('de terminar en 1 semana')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Ver como tabla' })[0]);
    expect(screen.getByRole('columnheader', { name: 'Semana desde' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver gráfico' }));
    expect(screen.queryByRole('columnheader', { name: 'Semana desde' })).not.toBeInTheDocument();
  });

  it('formato: días en singular y ejes con máximos redondos', () => {
    expect(fmtDays(1)).toBe('1,0 día');
    expect(fmtDays(2)).toBe('2,0 días');
    expect([0, 0.7, 3, 7, 13, 23, 480].map(niceMax)).toEqual([1, 1, 5, 10, 20, 25, 500]);
  });

  it('en la app se llega por la pestaña Métricas', async () => {
    installApi({
      'GET /auth/me': () => ana,
      'GET /boards': () => [{ id: 'b-1', name: 'Proyecto', role: 'owner' }],
      'GET /boards/:id': () => makeBoard(),
      'GET /boards/:id/metrics': () => makeAnalysis(),
      'GET /invites': () => [],
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Métricas' }));
    expect(await screen.findByText('Ritmo del equipo')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Tablero' }));
    expect(screen.getByText('Diseñar login')).toBeInTheDocument();
  });
});
