import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/error-boundary';
import './index.css';
import './scrollbar.css';
import './overlay.css';
import './graph-containers.css';
import './desktop-chrome.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element não encontrado');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
