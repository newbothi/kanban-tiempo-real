import { render, screen, within } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { describe, expect, it } from 'vitest';
import { CardItem, type CardInsight } from '../src/components/CardItem';
import { installApi } from './fake-api';
import { ana, makeAnalysis, makeBoard } from './fixtures';
import { renderApp } from './render';

const card = { id: 'k-1', columnId: 'c-doing', title: 'Tarea', position: 'a0' };

function renderCard(insight?: CardInsight) {
  return render(
    <DndContext>
      <SortableContext items={['k-1']}>
        <CardItem card={card} insight={insight} onDelete={() => {}} />
      </SortableContext>
    </DndContext>,
  );
}

describe('insignias de las tarjetas', () => {
  it('estancada: muestra cuánto lleva y lo normal', () => {
    renderCard({ stale: { days: 8, typical: 2.5 } });
    expect(screen.getByText('⚠ Estancada')).toHaveAttribute(
      'title',
      'Lleva 8 días en esta columna; lo normal son 2,5',
    );
  });

  it('atrasada: solo si no está ya marcada como estancada', () => {
    const { unmount } = renderCard({ overdue: true });
    expect(screen.getByText('⏱ Atrasada')).toBeInTheDocument();
    unmount();
    renderCard({ overdue: true, stale: { days: 8, typical: 2 } });
    expect(screen.queryByText('⏱ Atrasada')).not.toBeInTheDocument();
  });

  it('tiempo restante estimado, con coma decimal', () => {
    renderCard({ remainingDays: 3.25 });
    expect(screen.getByText('~3,3 d')).toBeInTheDocument();
  });

  it('sin análisis no muestra nada', () => {
    renderCard({});
    expect(screen.queryByText(/Estancada|Atrasada|~/)).not.toBeInTheDocument();
  });

  it('en el tablero, las tarjetas en cola (primera columna) no llevan estimación', async () => {
    installApi({
      'GET /auth/me': () => ana,
      'GET /boards': () => [{ id: 'b-1', name: 'Proyecto', role: 'owner' }],
      'GET /boards/:id': () => makeBoard(),
      'GET /boards/:id/metrics': () => makeAnalysis(),
      'GET /invites': () => [],
    });
    renderApp();
    const doing = (await screen.findByText('Bug: drag en móvil')).closest('.card') as HTMLElement;
    expect(await within(doing).findByText('⚠ Estancada')).toBeInTheDocument();
    // k-1 tiene predicción (~4 d) pero está en "Por hacer": no se muestra.
    const todo = screen.getByText('Diseñar login').closest('.card') as HTMLElement;
    expect(within(todo).queryByText(/~/)).not.toBeInTheDocument();
  });
});
