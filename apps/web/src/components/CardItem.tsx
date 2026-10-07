import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CardDto } from '@kanban/shared';

/** Lo que el análisis (servicio ML) dice de esta tarjeta. */
export interface CardInsight {
  stale?: { days: number; typical: number };
  remainingDays?: number;
  overdue?: boolean;
}

const days = (x: number) => x.toLocaleString('es-CL', { maximumFractionDigits: 1 });

interface Props {
  card: CardDto;
  insight?: CardInsight;
  onDelete?: (id: string) => void;
  overlay?: boolean;
}

export function CardItem({ card, insight, onDelete, overlay = false }: Props) {
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
      <span className="card__body">
        <span className="card__title">{card.title}</span>
        {insight && (insight.stale || insight.overdue || insight.remainingDays != null) && (
          <span className="card__insights">
            {insight.stale && (
              <span
                className="status-tag status-tag--serious"
                title={`Lleva ${days(insight.stale.days)} días en esta columna; lo normal son ${days(insight.stale.typical)}`}
              >
                ⚠ Estancada
              </span>
            )}
            {insight.overdue && !insight.stale && (
              <span className="status-tag status-tag--warning" title="Ya superó el tiempo estimado por el modelo">
                ⏱ Atrasada
              </span>
            )}
            {!insight.overdue && insight.remainingDays != null && (
              <span className="card__eta" title="Tiempo restante estimado por el modelo de ML">
                ~{days(insight.remainingDays)} d
              </span>
            )}
          </span>
        )}
      </span>
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
