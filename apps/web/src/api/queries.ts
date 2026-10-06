import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { applyMove, upsertCard, type BoardDto, type MoveCardInput, type UserDto } from '@kanban/shared';
import { ApiError, api } from './client';
import { connectSocket, disconnectSocket } from '../realtime/socket';

export const keys = {
  me: ['me'] as const,
  boards: ['boards'] as const,
  board: (id: string) => ['boards', id] as const,
  members: (id: string) => ['boards', id, 'members'] as const,
};

// ---------- Sesión ----------

/** Usuario actual, o null si no hay sesión. */
export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<UserDto | null> => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

/**
 * Cambia el usuario de la sesión y borra los datos cacheados del anterior.
 * OJO: no usar qc.clear(): borraría también la consulta `me` que la pantalla
 * está observando, y la UI no se enteraría del cambio.
 */
export function setSessionUser(qc: QueryClient, user: UserDto | null) {
  qc.setQueryData(keys.me, user);
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
}

/** Tras login/registro: guardamos el usuario y reconectamos el socket con la cookie nueva. */
function useStartSession() {
  const qc = useQueryClient();
  return (user: UserDto) => {
    setSessionUser(qc, user);
    connectSocket();
  };
}

export function useLogin() {
  const start = useStartSession();
  return useMutation({ mutationFn: api.login, onSuccess: start });
}

export function useRegister() {
  const start = useStartSession();
  return useMutation({ mutationFn: api.register, onSuccess: start });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      disconnectSocket();
      setSessionUser(qc, null); // vuelve al login y no deja datos del usuario anterior
    },
  });
}

// ---------- Tableros y miembros ----------

export const useBoards = () => useQuery({ queryKey: keys.boards, queryFn: api.listBoards });

export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteBoard,
    meta: { errorMessage: 'No se pudo eliminar el tablero' },
    // exact: solo la lista (['boards']), no cada tablero ni sus miembros
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.boards, exact: true }),
  });
}

export const useMembers = (boardId: string) =>
  useQuery({ queryKey: keys.members(boardId), queryFn: () => api.listMembers(boardId) });

export function useAddMember(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.addMember(boardId, { email }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(boardId) }),
  });
}

export function useRemoveMember(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(boardId, userId),
    meta: { errorMessage: 'No se pudo quitar al miembro' },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(boardId) }),
  });
}

export const useBoard = (id: string) =>
  useQuery({ queryKey: keys.board(id), queryFn: () => api.getBoard(id), retry: false });

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createBoard,
    meta: { errorMessage: 'No se pudo crear el tablero' },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.boards, exact: true }),
  });
}

export function useCreateCard(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createCard,
    meta: { errorMessage: 'No se pudo crear la tarjeta' },
    // upsert (no push) para que sea idempotente si la tarjeta ya llegó por otra vía
    onSuccess: (card) =>
      qc.setQueryData<BoardDto>(keys.board(boardId), (b) => (b ? upsertCard(b, card) : b)),
  });
}

/**
 * Patrón de actualización optimista:
 * 1. Se guarda una copia del tablero (snapshot).
 * 2. Se aplica el cambio en la caché al tiro, de forma SÍNCRONA (sin parpadeo al soltar).
 * 3. Si el servidor falla, se restaura el snapshot.
 * 4. Al terminar, se vuelve a pedir el tablero para quedar alineados con la BD.
 */
function optimistic(qc: QueryClient, boardId: string, update: (b: BoardDto) => BoardDto) {
  const key = keys.board(boardId);
  void qc.cancelQueries({ queryKey: key });
  const snapshot = qc.getQueryData<BoardDto>(key);
  if (snapshot) qc.setQueryData<BoardDto>(key, update(snapshot));
  return {
    rollback: () => snapshot && qc.setQueryData(key, snapshot),
    settle: () => qc.invalidateQueries({ queryKey: key }),
  };
}

export function useMoveCard(boardId: string) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ cardId, ...input }: MoveCardInput & { cardId: string }) =>
      api.moveCard(cardId, input),
    meta: { errorMessage: 'No se pudo mover la tarjeta; volvió a su lugar' },
  });

  return (cardId: string, input: MoveCardInput) => {
    const { rollback, settle } = optimistic(qc, boardId, (b) =>
      applyMove(b, cardId, input.columnId, input.index),
    );
    mutation.mutate({ cardId, ...input }, { onError: rollback, onSettled: settle });
  };
}

export function useDeleteCard(boardId: string) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: api.deleteCard,
    meta: { errorMessage: 'No se pudo eliminar la tarjeta' },
  });

  return (cardId: string) => {
    const { rollback, settle } = optimistic(qc, boardId, (b) => ({
      ...b,
      cards: b.cards.filter((c) => c.id !== cardId),
    }));
    mutation.mutate(cardId, { onError: rollback, onSettled: settle });
  };
}
