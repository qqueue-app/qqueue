import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button.js";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort catch for render-time throws. Without it, one throwing
 * component blanks the entire dashboard with no explanation (React unmounts
 * the whole tree). Class component by necessity — error boundaries have no
 * hook equivalent.
 *
 * Deliberately renders no app chrome: whatever threw might be in the chrome.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. Your data is safe — reloading
            usually fixes it. If it keeps happening, check the browser console
            and report what you find.
          </p>
          <Button type="button" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
