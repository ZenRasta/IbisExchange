import { retrieveRawInitData } from '@telegram-apps/sdk-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Cache initData on first successful retrieval so it survives React Router navigation
// (BrowserRouter strips the URL hash that contains tgWebAppData)
let cachedInitData: string | null = null;

function getInitData(): string {
  if (cachedInitData) return cachedInitData;

  // 1) Telegram WebApp global (most reliable in Telegram Mini Apps)
  try {
    const webAppData = window.Telegram?.WebApp?.initData;
    if (webAppData) {
      cachedInitData = webAppData;
      return webAppData;
    }
  } catch {}

  // 2) SDK's retrieveRawInitData (parses from launch params / URL hash)
  try {
    const data = retrieveRawInitData();
    if (data) {
      cachedInitData = data;
      return data;
    }
  } catch {}

  // 3) sessionStorage (persisted earlier by index.tsx)
  try {
    const stored = sessionStorage.getItem('tg_init_data');
    if (stored) {
      cachedInitData = stored;
      return stored;
    }
  } catch {}

  return '';
}

// Eagerly capture initData on module load (before React Router changes the URL)
try {
  const webAppData = window.Telegram?.WebApp?.initData;
  if (webAppData) {
    cachedInitData = webAppData;
    try { sessionStorage.setItem('tg_init_data', webAppData); } catch {}
  }
} catch {}

if (!cachedInitData) {
  try {
    const earlyData = retrieveRawInitData();
    if (earlyData) {
      cachedInitData = earlyData;
      try { sessionStorage.setItem('tg_init_data', earlyData); } catch {}
    }
  } catch {}
}

export async function apiCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const initData = getInitData();

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data as T;
}

// Type augmentation for Telegram WebApp
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: Record<string, unknown>;
        ready: () => void;
        close: () => void;
        expand: () => void;
        openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
        MainButton: unknown;
        BackButton: unknown;
        themeParams: Record<string, string>;
      };
    };
    Buffer: typeof import('buffer').Buffer;
  }
}
