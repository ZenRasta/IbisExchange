// Buffer polyfill is loaded via <script> tag in index.html (before this module).

import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  init,
  miniApp,
  themeParams,
  viewport,
  backButton,
  retrieveRawInitData,
} from '@telegram-apps/sdk-react';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App';
import './index.css';

// --- Telegram init data capture (before React Router can strip the URL hash) ---
try {
  const webAppData = window.Telegram?.WebApp?.initData;
  if (webAppData) {
    try { sessionStorage.setItem('tg_init_data', webAppData); } catch {}
  }
} catch {}

try {
  const rawInitData = retrieveRawInitData();
  if (rawInitData) {
    try { sessionStorage.setItem('tg_init_data', rawInitData); } catch {}
  }
} catch {}

// --- Telegram SDK initialization ---
let sdkReady = false;
try {
  init();
  sdkReady = true;
} catch {}

if (sdkReady) {
  try { miniApp.mount(); } catch {}
  try { if (!themeParams.isMounted()) themeParams.mount(); } catch {}
  try { backButton.mount(); } catch {}
  try { if (themeParams.bindCssVars.isAvailable()) themeParams.bindCssVars(); } catch {}
  try { if (miniApp.bindCssVars.isAvailable()) miniApp.bindCssVars(); } catch {}
  try {
    viewport.mount()
      .then(() => {
        try { if (viewport.bindCssVars.isAvailable()) viewport.bindCssVars(); } catch {}
        try { if (!viewport.isExpanded()) viewport.expand(); } catch {}
      })
      .catch(() => {});
  } catch {}
  try { miniApp.ready(); } catch {}
}

// Always signal readiness to Telegram, even if the SDK failed.
if (!sdkReady) {
  try {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  } catch {}
}

// Error Boundary
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#e53935', fontFamily: 'monospace', fontSize: 14 }}>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 16px', background: '#2481cc', color: '#fff', border: 'none', borderRadius: 8 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'IbisExchange_bot';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <TonConnectUIProvider
      manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}
      actionsConfiguration={{ twaReturnUrl: `https://t.me/${BOT_USERNAME}` }}
    >
      <App />
    </TonConnectUIProvider>
  </ErrorBoundary>
);
