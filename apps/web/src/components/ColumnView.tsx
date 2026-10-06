import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { CardDto, ColumnDto } from '@kanban/shared';
import { CardItem } from './CardItem';

interface Props {
  column: ColumnDto;
  cards: CardDto[];
  onAdd: (columnId: string, title: string) => Promise<unknown>;
  onDelete: (cardId: string) => void;
}

export function ColumnView({ column, cards, onAdd, onDelete }: Props) {
  // La columna también es "droppable" para poder soltar en columnas vacías.
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  });
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      await onAdd(column.id, title);
      setDraft('');
    } catch {
      // El aviso lo muestra el manejador global; conservamos el texto para reintentar.
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`column${isOver ? ' column--over' : ''}`}>
      <header className="column__header">
        <h2>{column.title}</h2>
        <span className="column__count">{cards.length}</span>
      </header>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="column__cards">
          {cards.map((card) => (
            <CardItem key={card.id} card={card} onDelete={onDelete} />
          ))}
          {cards.length === 0 && <p className="column__empty">Suelta tarjetas aquí</p>}
        </div>
      </SortableContext>

      <form className="column__form" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={saving ? 'Guardando…' : '+ Nueva tarjeta'}
          disabled={saving}
          aria-label={`Nueva tarjeta en ${column.title}`}
        />
      </form>
    </section>
  );
}
