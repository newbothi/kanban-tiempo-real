import type {
  AddMemberInput,
  BoardDto,
  BoardSummaryDto,
  CardDto,
  CreateBoardInput,
  CreateCardInput,
  LoginInput,
  MemberDto,
  MoveCardInput,
  RegisterInput,
  RenameCardInput,
  UserDto,
} from '@kanban/shared';
import { SOCKET_ID_HEADER } from '@kanban/shared';
import { socket } from '../realtime/socket';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Se llama cuando la API responde 401 (sesión vencida o cerrada). Lo configura main.tsx. */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body) headers['Content-Type'] = 'application/json';
  // Le decimos al servidor quién hizo el cambio, para que no nos reenvíe nuestro propio evento.
  if (socket.id) headers[SOCKET_ID_HEADER] = socket.id;

  // La cookie de sesión viaja sola: mismo origen (Vite redirige /api a la API).
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // En login/registro un 401 es "credenciales incorrectas", no "sesión vencida".
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    const message =
      body?.issues?.[0]?.message ?? body?.message ?? `Error ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  // Sesión
  me: () => request<UserDto>('/auth/me'),
  login: (input: LoginInput) => request<UserDto>('/auth/login', { method: 'POST', body: json(input) }),
  register: (input: RegisterInput) =>
    request<UserDto>('/auth/register', { method: 'POST', body: json(input) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  // Tableros
  listBoards: () => request<BoardSummaryDto[]>('/boards'),
  getBoard: (id: string) => request<BoardDto>(`/boards/${id}`),
  createBoard: (input: CreateBoardInput) =>
    request<BoardSummaryDto>('/boards', { method: 'POST', body: json(input) }),
  deleteBoard: (id: string) => request<void>(`/boards/${id}`, { method: 'DELETE' }),

  // Miembros
  listMembers: (boardId: string) => request<MemberDto[]>(`/boards/${boardId}/members`),
  addMember: (boardId: string, input: AddMemberInput) =>
    request<MemberDto>(`/boards/${boardId}/members`, { method: 'POST', body: json(input) }),
  removeMember: (boardId: string, userId: string) =>
    request<void>(`/boards/${boardId}/members/${userId}`, { method: 'DELETE' }),

  // Tarjetas
  createCard: (input: CreateCardInput) =>
    request<CardDto>('/cards', { method: 'POST', body: json(input) }),
  renameCard: (id: string, input: RenameCardInput) =>
    request<CardDto>(`/cards/${id}`, { method: 'PATCH', body: json(input) }),
  moveCard: (id: string, input: MoveCardInput) =>
    request<CardDto>(`/cards/${id}/move`, { method: 'POST', body: json(input) }),
  deleteCard: (id: string) => request<void>(`/cards/${id}`, { method: 'DELETE' }),
};
