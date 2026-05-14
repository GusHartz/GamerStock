import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
  inline?: boolean;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message ?? "Unknown error" };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    const label = this.props.label ?? "Component";
    console.error(`[ErrorBoundary:${label}]`, error.message, info.componentStack?.slice(0, 400));
  }

  reset = () => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    if (this.props.inline) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground bg-white/3 border border-white/10 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-amber-400/80">{this.props.label ?? "Section"} unavailable</span>
          <button
            onClick={this.reset}
            className="ml-auto text-muted-foreground hover:text-white transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-400/60" />
        <div>
          <p className="text-sm font-medium text-foreground/80">
            {this.props.label ?? "This section"} failed to load
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">
            {this.state.errorMessage?.slice(0, 120) || "An unexpected error occurred"}
          </p>
        </div>
        <button
          onClick={this.reset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs text-muted-foreground hover:text-white transition-colors border border-white/10"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message ?? "Unknown error" };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[AppErrorBoundary] Fatal render error:", error.message, info.componentStack?.slice(0, 600));
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-[#0A0E17] flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
            <p className="text-sm text-muted-foreground mt-1">
              An unexpected error occurred. Refreshing usually fixes this.
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors border border-primary/20"
            >
              <RefreshCw className="w-4 h-4" />
              Reload page
            </button>
          </div>
          {import.meta.env.DEV && (
            <details className="text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-white">
                Error details
              </summary>
              <pre className="mt-2 text-[10px] text-rose-400/80 bg-white/3 p-2 rounded overflow-auto max-h-32">
                {this.state.errorMessage}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
