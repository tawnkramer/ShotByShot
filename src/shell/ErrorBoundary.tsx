import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useProjectStore } from '../state/store';
import { isChunkError, reloadOnce } from './reload';

interface State {
  error: Error | null;
}

/**
 * Shows a way out instead of a blank screen when something crashes. A page
 * left over from an older version reloads itself to get the current code.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    if (isChunkError(error) && reloadOnce()) return;
    // Keep whatever was saved up to the crash.
    void useProjectStore.getState().flush().catch(() => {});
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p className="muted">Your projects are saved in this browser. Reloading usually fixes this.</p>
        <div className="row">
          <button className="btn primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            className="btn"
            onClick={() => {
              location.hash = '#/';
              location.reload();
            }}
          >
            Back to projects
          </button>
        </div>
        <details className="small muted">
          <summary>Details</summary>
          <pre>{error.message}</pre>
        </details>
      </div>
    );
  }
}
