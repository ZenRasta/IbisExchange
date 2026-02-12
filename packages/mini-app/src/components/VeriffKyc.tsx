import { useState, useCallback, useEffect } from 'react';
import { openLink } from '@telegram-apps/sdk-react';
import { apiCall } from '../lib/api';

// Helper: open a URL using the best available method in Telegram
function openExternalUrl(url: string): void {
  // 1) Try the global Telegram WebApp API (most reliable in Mini Apps)
  try {
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url, { try_instant_view: false });
      return;
    }
  } catch {}

  // 2) Try the SDK's openLink
  try {
    if (openLink.isAvailable()) {
      openLink(url, { tryInstantView: false });
      return;
    }
  } catch {}

  // 3) Fallback to window.open
  window.open(url, '_blank');
}

export function VeriffKyc({ onComplete }: { onComplete?: () => void }) {
    const [state, setState] = useState<'loading' | 'opened' | 'error'>('loading');

    const startKyc = useCallback(async () => {
        setState('loading');
        try {
            const data = await apiCall<any>('POST', '/api/kyc/start');

            if (data.status === 'already_verified') {
                onComplete?.();
                return;
            }

            const sessionUrl = data.sessionUrl;
            if (!sessionUrl) {
                setState('error');
                return;
            }

            openExternalUrl(sessionUrl);
            setState('opened');
        } catch {
            setState('error');
        }
    }, [onComplete]);

    // Auto-start on mount
    useEffect(() => { startKyc(); }, [startKyc]);

    if (state === 'loading') {
        return (
            <div className="flex justify-center p-8">
                <div className="animate-spin h-8 w-8 border-2 border-tg-button border-t-transparent rounded-full" />
            </div>
        );
    }

    if (state === 'opened') {
        return (
            <div className="text-center p-6">
                <p className="text-4xl mb-3">&#x1F4F7;</p>
                <p className="text-tg-text font-medium mb-2">Verification opened</p>
                <p className="text-tg-hint text-sm mb-4">
                    Complete the verification in the browser window, then come back here.
                </p>
                <button
                    onClick={() => onComplete?.()}
                    className="bg-tg-button text-tg-button-text px-6 py-3 rounded-xl font-semibold"
                >
                    I've finished — check status
                </button>
            </div>
        );
    }

    if (state === 'error') {
        return (
            <div className="text-center p-8">
                <p className="text-tg-destructive">
                    Failed to start verification.{' '}
                    <button onClick={startKyc} className="underline">
                        Retry
                    </button>
                </p>
            </div>
        );
    }

    return null;
}
