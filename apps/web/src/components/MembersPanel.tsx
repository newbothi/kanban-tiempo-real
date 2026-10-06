import { useState } from 'react';
import { addMemberSchema, type BoardRole, type UserDto } from '@kanban/shared';
import { useAddMember, useMembers, useRemoveMember } from '../api/queries';

interface Props {
  boardId: string;
  myRole: BoardRole;
  me: UserDto;
  onLeft: () => void;
}

export function MembersPanel({ boardId, myRole, me, onLeft }: Props) {
  const members = useMembers(boardId);
  const add = useAddMember(boardId);
  const remove = useRemoveMember(boardId);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isOwner = myRole === 'owner';

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = addMemberSchema.safeParse({ email });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    add.mutate(parsed.data.email, {
      onSuccess: () => setEmail(''),
      onError: (err) => setError(err.message),
    });
  };

  const leave = () => {
    if (!window.confirm('¿Salir de este tablero? Dejarás de verlo.')) return;
    remove.mutate(me.id, { onSuccess: onLeft });
  };

  return (
    <aside className="members">
      <h3>Miembros</h3>

      {members.isPending && <p className="status">Cargando…</p>}
      {members.isError && <p className="status status--error">{members.error.message}</p>}

      <ul className="members__list">
        {members.data?.map((m) => (
          <li key={m.userId}>
            <span className="members__avatar" aria-hidden>
              {m.name.charAt(0).toUpperCase()}
            </span>
            <span className="members__info">
              <strong>
                {m.name}
                {m.userId === me.id && ' (tú)'}
              </strong>
              <small>{m.email}</small>
            </span>
            {m.role === 'owner' ? (
              <span className="badge">Dueño</span>
            ) : (
              isOwner && (
                <button
                  className="link danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(m.userId)}
                >
                  Quitar
                </button>
              )
            )}
          </li>
        ))}
      </ul>

      {isOwner ? (
        <form className="members__invite" onSubmit={invite} noValidate>
          <label htmlFor="invite-email">Invitar por correo</label>
          <div className="row">
            <input
              id="invite-email"
              type="email"
              placeholder="persona@correo.cl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="primary" disabled={add.isPending}>
              Invitar
            </button>
          </div>
          {error && <p className="status status--error">{error}</p>}
          <p className="hint">La persona debe tener una cuenta creada.</p>
        </form>
      ) : (
        <button className="link danger" onClick={leave} disabled={remove.isPending}>
          Salir del tablero
        </button>
      )}
    </aside>
  );
}
