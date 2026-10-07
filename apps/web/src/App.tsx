import { useEffect, useMemo, useState } from 'react';
import { sortByPosition, type MlAnalysis, type UserDto } from '@kanban/shared';
import { Board } from './components/Board';
import { AuthScreen } from './components/AuthScreen';
import { MembersPanel } from './components/MembersPanel';
import { MetricsView } from './components/metrics/MetricsView';
import type { CardInsight } from './components/CardItem';
import {
  useBoard,
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useLogout,
  useMe,
  useMetrics,
} from './api/queries';
import {
  useBoardRealtime,
  useUserRealtime,
  type RealtimeStatus,
} from './realtime/useBoardRealtime';
import { ensureSocket } from './realtime/socket';

export default function App() {
  const me = useMe();

  if (me.isPending) return <p className="status app">Cargando…</p>;
  if (me.isError)
    return (
      <p className="status status--error app">
        No se pudo conectar con la API. ¿Está corriendo <code>npm run dev:api</code>?
      </p>
    );
  if (!me.data) return <AuthScreen />;
  return <Workspace me={me.data} />;
}

/** El tablero seleccionado vive en la URL (#id) para que sobreviva a F5. */
function useSelectedBoard() {
  const [id, setId] = useState(() => location.hash.slice(1) || null);
  useEffect(() => {
    const onHash = () => setId(location.hash.slice(1) || null);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const select = (next: string | null) => {
    history.replaceState(null, '', next ? `#${next}` : location.pathname);
    setId(next);
  };
  return [id, select] as const;
}

function Workspace({ me }: { me: UserDto }) {
  const boards = useBoards();
  const createBoard = useCreateBoard();
  const logout = useLogout();
  const [selected, select] = useSelectedBoard();
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useUserRealtime();
  useEffect(() => {
    ensureSocket(); // hay sesión: conectamos el socket (lleva la cookie)
  }, []);

  // Si el tablero seleccionado ya no está en mi lista, tomamos el primero.
  const list = boards.data ?? [];
  const current = list.find((b) => b.id === selected) ?? list[0];
  useEffect(() => {
    if (boards.isSuccess && current && current.id !== selected) select(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards.isSuccess, current?.id, selected]);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createBoard.mutate(
      { name },
      {
        onSuccess: (b) => {
          setNewName('');
          select(b.id);
        },
      },
    );
  };

  return (
    <main className="app">
      <header className="app__header">
        <h1>Kanban</h1>
        <p>Colaboración en tiempo real</p>
        <span className="app__spacer" />
        <span className="app__user">{me.name}</span>
        <button className="link" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Cerrar sesión
        </button>
      </header>

      <nav className="boards-nav">
        {list.map((b) => (
          <button
            key={b.id}
            className={`chip${b.id === current?.id ? ' is-active' : ''}`}
            onClick={() => {
              setNotice(null);
              select(b.id);
            }}
          >
            {b.name}
            {b.role === 'member' && <small> · compartido</small>}
          </button>
        ))}
        <form onSubmit={create} className="boards-nav__new">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="+ Nuevo tablero"
            aria-label="Nombre del nuevo tablero"
            disabled={createBoard.isPending}
          />
        </form>
      </nav>

      {notice && <p className="notice">{notice}</p>}
      {boards.isPending && <p className="status">Cargando tableros…</p>}
      {boards.isSuccess && list.length === 0 && (
        <p className="status">
          Aún no tienes tableros. Crea uno arriba o pide que te inviten a uno.
        </p>
      )}

      {current && (
        <BoardLoader
          key={current.id}
          id={current.id}
          me={me}
          onRemoved={() => {
            setNotice(`El tablero "${current.name}" fue eliminado o ya no tienes acceso.`);
            select(null);
            void boards.refetch();
          }}
        />
      )}
    </main>
  );
}

function BoardLoader({ id, me, onRemoved }: { id: string; me: UserDto; onRemoved: () => void }) {
  const board = useBoard(id);
  const deleteBoard = useDeleteBoard();
  const { status, viewers } = useBoardRealtime(id, onRemoved);
  const [showMembers, setShowMembers] = useState(false);
  const [view, setView] = useState<'board' | 'metrics'>('board');
  // El análisis también alimenta las insignias de las tarjetas (estancada / tiempo restante).
  const metrics = useMetrics(id);
  const backlogColumn = board.data ? sortByPosition(board.data.columns)[0]?.id : undefined;
  const backlogCards = useMemo(
    () => new Set(board.data?.cards.filter((c) => c.columnId === backlogColumn).map((c) => c.id)),
    [board.data, backlogColumn],
  );
  const insights = useMemo(() => toInsights(metrics.data, backlogCards), [metrics.data, backlogCards]);

  if (board.isPending) return <p className="status">Cargando tablero…</p>;
  if (board.isError) return <p className="status status--error">{board.error.message}</p>;

  const isOwner = board.data.role === 'owner';
  const remove = () => {
    if (!window.confirm(`¿Eliminar "${board.data.name}" y todas sus tarjetas?`)) return;
    deleteBoard.mutate(id);
  };

  return (
    <>
      <div className="toolbar">
        <h2 className="toolbar__title">{board.data.name}</h2>
        <div className="tabs" role="tablist" aria-label="Vista">
          <button role="tab" aria-selected={view === 'board'} onClick={() => setView('board')}>
            Tablero
          </button>
          <button role="tab" aria-selected={view === 'metrics'} onClick={() => setView('metrics')}>
            Métricas
          </button>
        </div>
        <div className="toolbar__actions">
          <Presence status={status} viewers={viewers} />
          <button className="link" onClick={() => setShowMembers((v) => !v)}>
            {showMembers ? 'Ocultar miembros' : 'Miembros'}
          </button>
          {isOwner && (
            <button className="link danger" onClick={remove} disabled={deleteBoard.isPending}>
              Eliminar tablero
            </button>
          )}
        </div>
      </div>

      <div className={`workspace${showMembers ? ' workspace--with-panel' : ''}`}>
        {view === 'board' ? (
          <Board board={board.data} insights={insights} />
        ) : (
          <MetricsView
            board={board.data}
            data={metrics.data}
            error={metrics.error}
            isFetching={metrics.isFetching}
          />
        )}
        {showMembers && (
          <MembersPanel boardId={id} myRole={board.data.role} me={me} onLeft={onRemoved} />
        )}
      </div>
    </>
  );
}

function toInsights(data: MlAnalysis | undefined, backlog: Set<string>): Map<string, CardInsight> {
  const map = new Map<string, CardInsight>();
  for (const p of data?.cycleTime?.predictions ?? []) {
    if (backlog.has(p.cardId)) continue; // en cola: la estimación sería ruido en el tablero
    map.set(p.cardId, { remainingDays: p.remainingDays, overdue: p.overdue });
  }
  for (const s of data?.stale ?? []) {
    map.set(s.cardId, { ...map.get(s.cardId), stale: { days: s.daysInColumn, typical: s.typicalDays } });
  }
  return map;
}

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  connecting: 'Conectando…',
  online: 'En vivo',
  offline: 'Sin conexión, reintentando…',
};

function Presence({ status, viewers }: { status: RealtimeStatus; viewers: number }) {
  return (
    <span className={`presence presence--${status}`}>
      <span className="presence__dot" aria-hidden />
      {STATUS_LABEL[status]}
      {status === 'online' && ` · ${viewers} ${viewers === 1 ? 'conectado' : 'conectados'}`}
    </span>
  );
}
