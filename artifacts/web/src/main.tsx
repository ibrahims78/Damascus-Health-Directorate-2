import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';

import { installOfflineApi } from './lib/offline-api';
import { installCsrfClient } from './lib/csrf-client';
import { ProtectedBuildGate } from './components/protected-build-gate';
import { ErrorBoundary } from './components/error-boundary';

// Install the CSRF header injector first so the offline wrapper (which
// replaces window.fetch for /api/* in offline mode) chains on top of it.
installCsrfClient();

if (import.meta.env.VITE_OFFLINE_MODE === '1') {
  installOfflineApi();
}

const app = (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
createRoot(document.getElementById('root')!).render(
  import.meta.env.VITE_PROTECTED_BUILD === '1' ? <ProtectedBuildGate>{app}</ProtectedBuildGate> : app,
);
