import type { MlCycleTime } from '@kanban/shared';
import { fmtDays } from './format';

const NAMES: Record<MlCycleTime['bestModel'], string> = {
  baseline_median: 'Mediana (referencia)',
  linear_regression: 'Regresión lineal',
  gradient_boosting: 'Gradient boosting',
};

/** Error de cada modelo en validación cruzada. Una sola serie: el ganador va destacado. */
export function ModelComparison({ cycleTime }: { cycleTime: MlCycleTime }) {
  const max = Math.max(...cycleTime.scores.map((s) => s.maeDays));
  return (
    <div className="models">
      {cycleTime.scores.map((s) => {
        const best = s.name === cycleTime.bestModel;
        return (
          <div key={s.name} className={`models__row${best ? ' is-best' : ''}`}>
            <span className="models__name">
              {NAMES[s.name]}
              {best && <span className="badge">mejor</span>}
            </span>
            <span className="models__track">
              <span className="models__bar" style={{ width: `${(s.maeDays / max) * 100}%` }} />
            </span>
            <span className="models__value">{fmtDays(s.maeDays)}</span>
          </div>
        );
      })}
      <p className="hint">
        Error absoluto medio en validación cruzada ({cycleTime.nTrain} tarjetas terminadas). Menos es mejor.
      </p>
    </div>
  );
}
