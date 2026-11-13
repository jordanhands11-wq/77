import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { clearEngineState } from '../utils/storage.ts';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('77 TRADE IT UI ErrorBoundary caught:', error, info);
  }

  handleRecover = () => {
    this.setState({ hasError: false, message: '' });
  };

  handleClearAndReload = () => {
    clearEngineState();
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#050811] text-[#eef2f8] flex items-center justify-center p-4">
        <div className="max-w-md w-full terminal-card p-6 border-[#5d2331] space-y-4">
          <div className="flex items-center gap-3 text-[#ff667a]">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <div>
              <h1 className="text-base font-bold text-[#eef2f8]">77 TRADE IT — Terminal Recovery</h1>
              <p className="text-xs text-[#8190a8]">
                A rendering exception interrupted the current view.
              </p>
            </div>
          </div>

          <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3 text-xs font-mono text-[#ff667a] break-words">
            {this.state.message}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={this.handleRecover}
              className="flex-1 py-2.5 px-3 rounded-lg border border-[#1b2940] text-xs font-semibold text-[#eef2f8] hover:border-[#d4af37]"
            >
              Recover Terminal
            </button>
            <button
              type="button"
              onClick={this.handleClearAndReload}
              className="flex-1 gold-button py-2.5 px-3 rounded-lg text-xs inline-flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear Local Cache &amp; Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
