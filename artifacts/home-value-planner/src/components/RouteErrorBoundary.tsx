import { Component, type ErrorInfo, type ReactNode } from "react";

interface RouteErrorBoundaryProps {
  children: ReactNode;
  /** The error clears when this changes, e.g. the route path, so navigating away recovers. */
  resetKey: string;
}

interface RouteErrorBoundaryState {
  error: Error | null;
  resetKey: string;
}

/**
 * Keeps a render error or a failed lazy page load (common right after a redeploy replaces the old chunks)
 * from blanking the whole app. The navigation stays usable, and reloading fetches the current build.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: RouteErrorBoundaryProps, state: RouteErrorBoundaryState): Partial<RouteErrorBoundaryState> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app] page failed to render", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div role="alert" className="card-pad space-y-3">
        <h1 className="font-display text-2xl text-ink">This page could not be shown</h1>
        <p className="text-sm leading-6 text-muted">
          Something went wrong while loading this page. If the dashboard was just updated, reloading picks up the latest version. Your saved inputs and scenarios stay in this browser.
        </p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    );
  }
}
