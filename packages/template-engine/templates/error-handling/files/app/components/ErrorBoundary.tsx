"use client";

import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { ErrorFallback } from "./ErrorFallback";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ComponentType<{ error: Error; reset: () => void }>;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time errors in its subtree and shows a fallback instead of a
 * blank screen. Wrap top-level trees with it (e.g. in app/layout.tsx). Note:
 * error boundaries do NOT catch errors in event handlers or async code — handle
 * those where they occur.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Swap this for your observability logger if the `observability` template is
    // installed; console.error is the dependency-free default.
    console.error("ErrorBoundary caught an error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      const Fallback = this.props.fallback ?? ErrorFallback;
      return (
        <Fallback
          error={this.state.error as Error}
          reset={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
