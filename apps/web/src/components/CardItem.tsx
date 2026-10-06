import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CardDto } from '@kanban/shared';

interface Props {
  card: CardDto;
  onDelete?: (id: string) => void;
  overlay?: boolean;
}

export function CardItem({ card, onDelete, overlay = false }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', columnId: card.columnId },
    disabled: overlay,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : style}
      className={`card${isDragging ? ' card--ghost' : ''}${overlay ? ' card--overlay' : ''}`}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
    >
      <span className="card__title">{card.title}</span>
      {onDelete && !overlay && (
        <button
          className="card__delete"
          aria-label={`Eliminar ${card.title}`}
          // evita que el clic inicie un arrastre
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(card.id)}
        >
          ×
        </button>
      )}
    </div>
  );
}
