import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Printer } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Qprint Uncaught Error Boundary]:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetCache = () => {
    try {
      localStorage.removeItem('qprint_token');
    } catch (e) {}
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-800 rounded-2xl p-6 sm:p-8 border border-slate-700 shadow-2xl text-center space-y-5">
            <div className="w-14 h-14 bg-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mx-auto border border-rose-500/30">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <Printer className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-sm text-slate-300">Qprint | By: HEMALESH</span>
              </div>
              <h1 className="text-xl font-black text-white">Something went wrong</h1>
              <p className="text-xs text-slate-400 mt-1">
                The application encountered an unexpected runtime issue. Don't worry, your data is safe.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="p-3 bg-slate-950/60 rounded-xl text-left border border-slate-800 text-[11px] font-mono text-rose-300 break-words max-h-24 overflow-y-auto">
                {this.state.error.message}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={this.handleReload}
                className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload App</span>
              </button>

              <button
                onClick={this.handleResetCache}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset Session</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
