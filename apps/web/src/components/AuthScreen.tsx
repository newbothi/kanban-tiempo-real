import { useState } from 'react';
import { loginSchema, registerSchema } from '@kanban/shared';
import { useLogin, useRegister } from '../api/queries';

type Mode = 'login' | 'register';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [clientError, setClientError] = useState<string | null>(null);
  const login = useLogin();
  const register = useRegister();
  const mutation = mode === 'login' ? login : register;

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

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
