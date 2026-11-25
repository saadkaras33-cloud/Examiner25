import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function formatBoundaryMessage(error: Error | null): string {
  if (!error) return 'An unexpected error occurred.';
  const raw = error.message || '';
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string; operationType?: string; path?: string };
      if (parsed?.error) {
        if (parsed.error.toLowerCase().includes('missing or insufficient permissions')) {
          return 'Cloud sync permission check failed for your session. Try reloading or signing in again.';
        }
        return parsed.error;
      }
    } catch {
      // Fall through to raw message
    }
  }
  return raw || 'Something went wrong while rendering the app.';
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Examiner UI error:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="min-h-dvh w-full bg-paper text-primary flex items-center justify-center p-4">
        <div className="w-full max-w-md card p-6 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-secondary/12 grid place-items-center text-secondary">
            <AlertTriangle size={24} />
          </div>
          <h1 className="font-display text-xl font-semibold">Something interrupted Examiner</h1>
          <p className="text-[0.86rem] text-primary/70 leading-relaxed break-words">
            {formatBoundaryMessage(this.state.error)}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="h-10 px-5 rounded-xl bg-primary text-on-primary text-[0.86rem] font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw size={15} />
            <span>Reload app</span>
          </button>
        </div>
      </div>
    );
  }
}
