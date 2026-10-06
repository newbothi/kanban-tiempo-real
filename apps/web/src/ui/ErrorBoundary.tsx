import { Component, type ReactNode } from 'react';

/** Si un componente lanza un error al renderizar, mostramos esto en vez de una pantalla en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Algo salió mal</h1>
        <p>Ocurrió un error inesperado en la aplicación.</p>
        <button className="primary" onClick={() => location.reload()}>
          Recargar
        </button>
      </div>
    );
  }
}
