import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { removeCard, upsertCard, type BoardDto, type CardDto } from '@kanban/shared';
import { keys, refreshMetricsSoon } from '../api/queries';
import { socket } from './socket';

export type RealtimeStatus = 'connecting' | 'online' | 'offline';

/**
 * Eventos dirigidos al usuario (no a un tablero en particular):
 * su lista de tableros cambió, o lo sacaron de uno.
 */
export function useUserRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const onBoardsChanged = () => void qc.invalidateQueries({ queryKey: keys.boards, exact: true });
    const onConnectError = (err: Error) => {
      // El servidor rechazó el handshake: la sesión ya no es válida.
      if (err.message === 'unauthorized') void qc.invalidateQueries({ queryKey: keys.me });
    };
    socket.on('boards:changed', onBoardsChanged);
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('boards:changed', onBoardsChanged);
      socket.off('connect_error', onConnectError);
    };
  }, [qc]);
}

/**
 * Suscribe el tablero a los eventos en tiempo real:
 * - entra a la room del tablero al conectar (y al RE-conectar);
 * - al reconectar vuelve a pedir el tablero, por si se perdió algún evento;
 * - aplica en la caché de TanStack Query lo que hicieron los demás;
 * - avisa si perdiste acceso al tablero.
 */
export function useBoardRealtime(boardId: string, onRemoved: () => void) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>(socket.connected ? 'online' : 'connecting');
  const [viewers, setViewers] = useState(1);
  const onRemovedRef = useRef(onRemoved);
  onRemovedRef.current = onRemoved;

  useEffect(() => {
    const key = keys.board(boardId);
    const update = (fn: (b: BoardDto) => BoardDto) =>
      qc.setQueryData<BoardDto>(key, (b) => (b ? fn(b) : b));

    const join = () => {
      socket.emit('board:join', boardId, (res) => {
        if (!res.ok) console.warn('[realtime] no se pudo entrar al tablero:', res.error);
      });
    };

    let firstConnect = true;
    const onConnect = () => {
      setStatus('online');
      join();
      // Si es una REconexión, pudimos perder eventos mientras estábamos fuera.
      if (!firstConnect) void qc.invalidateQueries({ queryKey: key });
      firstConnect = false;
    };
    const onDisconnect = () => setStatus('offline');
    // Lo que hacen los demás también cambia las métricas: se recalculan (agrupadas).
    const onUpsert = (card: CardDto) => {
      update((b) => upsertCard(b, card));
      refreshMetricsSoon(qc, boardId);
    };
    const onDeleted = ({ id }: { id: string }) => {
      update((b) => removeCard(b, id));
      refreshMetricsSoon(qc, boardId);
    };
    const onPresence = (p: { boardId: string; count: number }) => {
      if (p.boardId === boardId) setViewers(p.count);
    };
    const onMembersChanged = (p: { boardId: string }) => {
      if (p.boardId === boardId) void qc.invalidateQueries({ queryKey: keys.members(boardId) });
    };
    const onBoardRemoved = (p: { boardId: string }) => {
      if (p.boardId !== boardId) return;
      qc.removeQueries({ queryKey: key });
      onRemovedRef.current();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    socket.on('card:created', onUpsert);
    socket.on('card:updated', onUpsert);
    socket.on('card:deleted', onDeleted);
    socket.on('board:presence', onPresence);
    socket.on('board:membersChanged', onMembersChanged);
    socket.on('board:removed', onBoardRemoved);

    if (socket.connected) {
      firstConnect = false;
      join();
    }

    return () => {
      socket.emit('board:leave', boardId);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.off('card:created', onUpsert);
      socket.off('card:updated', onUpsert);
      socket.off('card:deleted', onDeleted);
      socket.off('board:presence', onPresence);
      socket.off('board:membersChanged', onMembersChanged);
      socket.off('board:removed', onBoardRemoved);
    };
  }, [boardId, qc]);

  return { status, viewers };
}
