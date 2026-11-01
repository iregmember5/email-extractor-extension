import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Keep private task data out of logs. */
  }
  render() {
    return this.state.failed ? (
      <div className="setup-screen">
        <h1>Let’s reopen your workspace.</h1>
        <p>Something interrupted the panel. Your backend extractions continue independently.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload panel
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
