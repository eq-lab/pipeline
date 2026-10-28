// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers
import { Component, type ErrorInfo, type ReactNode } from "react";
import type { AnyRouter } from "@tanstack/react-router";
import { Button } from "@pipeline/ui";
import { reportAppError } from "@/lib/diagnostics";

export function AppErrorView({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : `Non-error value thrown: ${String(error)}`;
  const stack = error instanceof Error ? error.stack : undefined;
  return (
    <div
      role="alert"
      className="flex min-h-screen flex-col items-start gap-4 bg-[var(--color-pipeline-paper)] p-8 text-[color:var(--color-pipeline-ink)]"
    >
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p>{message}</p>
      <p className="text-sm">Path: {window.location.pathname}</p>
      {stack && (
        <pre className="max-w-full overflow-auto text-xs whitespace-pre-wrap">
          {stack}
        </pre>
      )}
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}

interface Props {
  router?: AnyRouter;
  children: ReactNode;
}

interface State {
  caught: boolean;
  error: unknown;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { caught: false, error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { caught: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    reportAppError("render", error, this.props.router, info.componentStack);
  }

  render() {
    if (this.state.caught) return <AppErrorView error={this.state.error} />;
    return this.props.children;
  }
}
