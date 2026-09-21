import { Component, type ErrorInfo, type ReactNode } from "react";

interface ExtensionPanelBoundaryProps {
  children: ReactNode;
  implementation: unknown;
  resetKey: string;
}

interface ExtensionPanelBoundaryState {
  failed: boolean;
}

export class ExtensionPanelBoundary extends Component<
  ExtensionPanelBoundaryProps,
  ExtensionPanelBoundaryState
> {
  state: ExtensionPanelBoundaryState = { failed: false };

  static getDerivedStateFromError(): ExtensionPanelBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Provider details are intentionally not rendered or logged by this package.
  }

  componentDidUpdate(previous: ExtensionPanelBoundaryProps): void {
    if (
      this.state.failed &&
      (previous.resetKey !== this.props.resetKey ||
        previous.implementation !== this.props.implementation)
    ) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed
      ? (
        <div role="alert">
          <p>Extension panel unavailable.</p>
          <button type="button" onClick={() => this.setState({ failed: false })}>
            Retry extension panel
          </button>
        </div>
      )
      : this.props.children;
  }
}
