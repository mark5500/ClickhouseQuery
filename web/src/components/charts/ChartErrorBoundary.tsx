import { Component, type ReactNode } from "react";

export class ChartErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <p className="text-destructive text-sm">Failed to render: {this.state.error.message}</p>;
    }
    return this.props.children;
  }
}
