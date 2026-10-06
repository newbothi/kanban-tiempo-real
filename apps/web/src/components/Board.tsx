import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { cardsOf, positionForMove, sortByPosition, type BoardDto, type CardDto } from '@kanban/shared';
import { useCreateCard, useDeleteCard, useMoveCard } from '../api/queries';
import { ColumnView } from './ColumnView';
import { CardItem } from './CardItem';

export function Board({ board }: { board: BoardDto }) {
  const moveCard = useMoveCard(board.id);
  const deleteCard = useDeleteCard(board.id);
  const createCard = useCreateCard(board.id);

  // Mientras se arrastra trabajamos sobre una copia local (dragCards) para no
  // golpear la API en cada movimiento del mouse. Al soltar se envía UN solo "move".
  const [dragCards, setDragCards] = useState<CardDto[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const cards = dragCards ?? board.cards;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = sortByPosition(board.columns);
  const activeCard = cards.find((c) => c.id === activeId) ?? null;

  const columnOf = (list: CardDto[], id: string): string | undefined => {
    if (board.columns.some((col) => col.id === id)) return id;
    return list.find((c) => c.id === id)?.columnId;
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDragCards(board.cards);
  };

  // Cambio de columna en vivo (solo en la copia local).
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragCards((prev) => {
      if (!prev) return prev;
      const cardId = String(active.id);
      const from = columnOf(prev, cardId);
      const to = columnOf(prev, String(over.id));
      if (!from || !to || from === to) return prev;

      const target = cardsOf(prev, to);
      const overIndex = target.findIndex((c) => c.id === over.id);
      const index = overIndex >= 0 ? overIndex : target.length;
      const position = positionForMove(prev, cardId, to, index);
      return prev.map((c) => (c.id === cardId ? { ...c, columnId: to, position } : c));
    });
  };

  const finishDrag = () => {
    setActiveId(null);
    setDragCards(null);
  };

  // Al soltar: calculamos columna + índice final y enviamos un único movimiento.
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const local = dragCards;
    const cardId = String(active.id);
    const original = board.cards.find((c) => c.id === cardId);

    if (!over || !local || !original) return finishDrag();
    const columnId = columnOf(local, String(over.id));
    if (!columnId) return finishDrag();

    const list = cardsOf(local, columnId);
    const oldIndex = list.findIndex((c) => c.id === cardId);
    const overIndex = list.findIndex((c) => c.id === over.id);
    const newIndex = overIndex >= 0 ? overIndex : list.length - 1;
    const index = arrayMove(list, oldIndex, newIndex).findIndex((c) => c.id === cardId);

    const originalIndex = cardsOf(board.cards, original.columnId).findIndex((c) => c.id === cardId);
    const unchanged = columnId === original.columnId && index === originalIndex;

    // moveCard actualiza la caché de forma síncrona, así que al limpiar
    // dragCards en el mismo render la tarjeta ya aparece en su nuevo lugar.
    if (!unchanged) moveCard(cardId, { columnId, index });
    finishDrag();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={finishDrag}
    >
      <div className="board">
        {columns.map((col) => (
          <ColumnView
            key={col.id}
            column={col}
            cards={cardsOf(cards, col.id)}
            onAdd={(columnId, title) => createCard.mutateAsync({ columnId, title })}
            onDelete={deleteCard}
          />
        ))}
      </div>

      <DragOverlay>{activeCard ? <CardItem card={activeCard} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
