import { useState } from 'react';
import { loginSchema, registerSchema } from '@kanban/shared';
import { useInvitePreview, useLogin, useRegister } from '../api/queries';
import { inviteTokenFromUrl } from '../api/inviteLink';

type Mode = 'login' | 'register';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  // email null = todavía no lo escribió (se puede completar con el del enlace de invitación).
  const [draft, setDraft] = useState<{ email: string | null; name: string; password: string }>({
    email: null,
    name: '',
    password: '',
  });
  const [clientError, setClientError] = useState<string | null>(null);
  const login = useLogin();
  const register = useRegister();
  const mutation = mode === 'login' ? login : register;

  // Si llegó desde el correo de invitación: mostramos quién invita y completamos el correo.
  const invite = useInvitePreview(inviteTokenFromUrl());
  const form = { ...draft, email: draft.email ?? invite.data?.email ?? '' };

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((f) => ({ ...f, [field]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);
    // Validamos con los MISMOS schemas que usa la API (vienen de packages/shared).
    if (mode === 'login') {
      const parsed = loginSchema.safeParse(form);
      if (!parsed.success) return setClientError(parsed.error.issues[0].message);
      login.mutate(parsed.data);
    } else {
      const parsed = registerSchema.safeParse(form);
      if (!parsed.success) return setClientError(parsed.error.issues[0].message);
      register.mutate(parsed.data);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setClientError(null);
    login.reset();
    register.reset();
  };

  const error = clientError ?? mutation.error?.message;

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit} noValidate>
        <h1>Kanban</h1>
        {invite.data && (
          <p className="notice" role="status">
            <strong>{invite.data.invitedBy}</strong> te invitó a «{invite.data.boardName}». Entra o crea tu cuenta con{' '}
            <strong>{invite.data.email}</strong> para verla.
          </p>
        )}
        {invite.isError && (
          <p className="notice notice--warning" role="status">
            El enlace de invitación no es válido o ya venció. Pide que te inviten de nuevo.
          </p>
        )}
        <div className="auth__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'is-active' : ''}
            onClick={() => switchMode('login')}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'is-active' : ''}
            onClick={() => switchMode('register')}
          >
            Crear cuenta
          </button>
        </div>

        {mode === 'register' && (
          <label>
            Nombre
            <input value={form.name} onChange={set('name')} autoComplete="name" />
          </label>
        )}
        <label>
          Correo
          <input type="email" value={form.email} onChange={set('email')} autoComplete="email" />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>

        {error && <p className="auth__error" role="alert">{error}</p>}

        <button className="primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>

        {mode === 'login' && (
          <p className="auth__hint">
            Demo: <code>demo@kanban.cl</code> / <code>demo1234</code>
          </p>
        )}
      </form>
    </div>
  );
}
