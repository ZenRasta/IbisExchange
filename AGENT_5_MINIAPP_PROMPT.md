# Agent 5 Prompt: Telegram Mini App UI (React + Tailwind + TON Connect)

## Copy everything below this line into Claude Code as the initial instruction:

---

You are the **Mini App UI Agent** for Project Ibis — a Telegram-based P2P USDT exchange. Your job is to build the React + Tailwind Telegram Mini App that serves as the primary user interface. Users browse the order book, create orders, manage trades, lock USDT in escrow via TON Connect, and complete KYC — all within this Mini App running inside Telegram.

**Read the reference doc first:** `/var/www/ibis/reference-docs/MINI_APP_REFERENCE.md`

**Wait for Agents 1, 2, 4, and 6:** Check that these files exist before starting:
- `/var/www/ibis/.agent-1-complete` (infrastructure)
- `/var/www/ibis/.agent-4-complete` (API routes — you need the API contract)
Read Agent 4's completion file for the API port. Read Agent 2's completion file for the escrow contract address. If Agent 6 isn't done yet, stub the KYC page with a placeholder.

## Your Workspace

`/var/www/ibis/packages/mini-app/`

## Your Responsibilities

You own:
- All React components, pages, hooks, and utilities in `packages/mini-app/src/`
- Vite config, Tailwind config, index.html
- TON Connect integration (wallet connection + Jetton transfers)
- Telegram Mini App SDK initialization
- `public/tonconnect-manifest.json`

You do NOT touch:
- API server code (Agent 4)
- Bot logic (Agent 3)
- Smart contract (Agent 2)
- Backend KYC logic (Agent 6) — you only build the frontend KYC page that embeds Veriff InContext SDK

## Task Checklist

### 1. Project Setup

```bash
cd /var/www/ibis/packages/mini-app
npm install @telegram-apps/sdk-react @telegram-apps/react-router-integration
npm install @tonconnect/ui-react @ton/ton @ton/core
npm install react-router-dom buffer
npm install -D @vitejs/plugin-react vite typescript tailwindcss postcss autoprefixer @types/react @types/react-dom
```

**`vite.config.ts`:**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  define: { 'process.env': {}, global: 'globalThis' },
  resolve: { alias: { buffer: 'buffer/' } },
  build: { outDir: 'dist', sourcemap: false },
});
```

**`tailwind.config.js`:**
```javascript
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tg: {
          bg: 'var(--tg-theme-bg-color)',
          text: 'var(--tg-theme-text-color)',
          hint: 'var(--tg-theme-hint-color)',
          link: 'var(--tg-theme-link-color)',
          button: 'var(--tg-theme-button-color)',
          'button-text': 'var(--tg-theme-button-text-color)',
          'secondary-bg': 'var(--tg-theme-secondary-bg-color)',
          'section-bg': 'var(--tg-theme-section-bg-color)',
          accent: 'var(--tg-theme-accent-text-color)',
          destructive: 'var(--tg-theme-destructive-text-color)',
        },
      },
    },
  },
};
```

**`public/tonconnect-manifest.json`:**
```json
{
  "url": "https://yourdomain.com",
  "name": "Ibis P2P Exchange",
  "iconUrl": "https://yourdomain.com/icon-192.png"
}
```

### 2. Entry Point (`src/index.tsx`)

```typescript
import { Buffer } from 'buffer';
window.Buffer = Buffer;

import ReactDOM from 'react-dom/client';
import { init, miniApp, themeParams, viewport, backButton } from '@telegram-apps/sdk-react';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App';
import './index.css';

// Initialize Telegram Mini App SDK
init();
miniApp.mount();
themeParams.mount();
backButton.mount();

if (themeParams.bindCssVars.isAvailable()) themeParams.bindCssVars();
if (miniApp.bindCssVars.isAvailable()) miniApp.bindCssVars();

viewport.mount().then(() => {
    if (viewport.bindCssVars.isAvailable()) viewport.bindCssVars();
    if (!viewport.isExpanded()) viewport.expand();
});

miniApp.ready();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <TonConnectUIProvider
        manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}
        actionsConfiguration={{ twaReturnUrl: `https://t.me/${import.meta.env.VITE_BOT_USERNAME}` }}
    >
        <App />
    </TonConnectUIProvider>
);
```

**CRITICAL:** The `Buffer` polyfill MUST be at the very top — `@ton/core` uses it for binary operations. Without it, TON Connect will crash.

### 3. App Shell (`src/App.tsx`)

Implement:
- Router with Telegram back button integration
- Bottom tab navigation (Orders, My Trades, Create, Profile)
- Safe area padding using `viewport.safeAreaInsets` (NOT `env(safe-area-inset-*)` — doesn't work in Telegram WebView)
- Telegram theme color integration (all colors from CSS variables)
- TonConnectButton in header
- Loading state while connection restores

### 4. Pages to Build

**`src/pages/Home.tsx`** — Landing/Dashboard
- Show user's USDT balance (from connected wallet via TonAPI)
- Quick stats: active orders, pending trades
- Prominent "Buy USDT" and "Sell USDT" action cards
- Recent completed trades feed

**`src/pages/OrderBook.tsx`** — Browse orders
- Two tabs: "Buy" (people wanting to buy) and "Sell" (people wanting to sell)
- Each order card shows: amount, price in TTD, total TTD, payment methods, seller reputation, verified badge
- Tap to expand → show bank details (for sell orders) + "Accept" button
- Pull-to-refresh
- Sort by: Best Price, Highest Reputation, Newest
- Filter by: Payment Method, Min/Max Amount

**`src/pages/CreateOrder.tsx`** — Create buy/sell order
- Toggle: Sell USDT / Buy USDT
- Amount input (USDT) with live TTD conversion preview
- Price per USDT input (TTD) — show market rate hint (~6.80)
- Payment method multi-select chips (Republic Bank, First Citizens, etc.)
- Bank details textarea (for sell orders)
- Summary card before confirmation
- Submit button → calls POST /api/orders

**`src/pages/Trade.tsx`** — Active trade view (most complex page)
- Shows trade status with step indicator:
  ```
  ① Accepted → ② Escrow Locked → ③ Fiat Sent → ④ Completed
  ```
- **Status: AWAITING_ESCROW (buyer view)**
  - Show "Lock X USDT in Escrow" button
  - Button triggers TON Connect Jetton transfer (see LockEscrow component)
  - Show countdown timer (30 min to fund)

- **Status: ESCROW_LOCKED (buyer view)**
  - Show seller's bank details
  - Show payment reference: TRD-XXXX
  - "I've Sent Payment" button → calls POST /api/trades/:id/fiat-sent

- **Status: FIAT_SENT (seller view)**
  - Show buyer's payment reference
  - "Payment Received" button → calls POST /api/trades/:id/confirm-receipt
  - "Not Received / Dispute" button → calls POST /api/trades/:id/dispute
  - Countdown: 6 hours until auto-release

- **Status: COMPLETED**
  - Success animation ✅
  - Trade summary: amount, price, fee, net received
  - Rate counterparty (1-5 stars)

- **Status: DISPUTED**
  - Show dispute details
  - Chat-style message area for evidence (future enhancement)
  - If admin: resolution buttons

**`src/pages/MyTrades.tsx`** — Trade history
- Tabs: Active | Completed | Disputed
- Trade cards with status badges
- Tap to open Trade page

**`src/pages/Profile.tsx`** — User profile
- Avatar, name, username
- Connected wallet address (truncated with copy button)
- KYC status badge: ✅ Verified, ⏳ Pending, ❌ Unverified
- "Get Verified" button → navigates to KYC page
- Stats: trades completed, success rate, total volume, reputation score
- Trade limits display (current max based on KYC)
- My active orders list with cancel buttons

**`src/pages/KycVerification.tsx`** — KYC flow
- Step indicator: ID Upload → Face Scan → Bank Statement → Review
- Embed Veriff InContext SDK component (Agent 6 provides the VeriffKyc React component)
- Or if Agent 6 not complete: placeholder page with "KYC coming soon" message
- After completion: show status (pending review / approved / rejected)

### 5. Core Component: LockEscrow (`src/components/LockEscrow.tsx`)

This is the **critical payment component**. Follow this exact implementation:

```typescript
import { useTonConnectUI, useTonWallet, useTonAddress } from '@tonconnect/ui-react';
import { beginCell, toNano, Address } from '@ton/core';

const ESCROW_CONTRACT = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS;

async function getUserUsdtWallet(userAddress: string): Promise<string> {
    const res = await fetch(
        `https://testnet.tonapi.io/v2/accounts/${encodeURIComponent(userAddress)}/jettons/${encodeURIComponent(import.meta.env.VITE_USDT_MASTER)}`
    );
    const data = await res.json();
    return data.wallet_address.address;
}

// CRITICAL: USDT = 6 decimals. NEVER use toNano() for USDT amounts.
function usdtToUnits(amount: number): bigint {
    return BigInt(Math.round(amount * 1_000_000));
}
```

Follow the complete LockEscrow pattern from the technical reference — build the Jetton transfer body with:
- opcode `0xf8a7ea5`
- amount in 6-decimal units
- destination = escrow contract
- forwardTonAmount = 0.05 TON (for transfer notification)
- forwardPayload = escrow ID encoded as uint64

### 6. API Client (`src/lib/api.ts`)

```typescript
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function apiCall<T>(method: string, path: string, body?: object): Promise<T> {
    const lp = retrieveLaunchParams();
    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': lp.initDataRaw || '',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.data;
}
```

### 7. Design Guidelines

- **Use Telegram theme colors exclusively** — never hardcode colors. Use the `tg-*` Tailwind classes.
- **Mobile-first** — Mini Apps are always on mobile. Design for 375px width minimum.
- **Bottom tab navigation** — 4 tabs with icons: Orders, My Trades, Create (+), Profile
- **Card-based layout** — use `bg-tg-section-bg rounded-2xl p-4` for content cards
- **Haptic feedback** — call `miniApp.hapticFeedback.impactOccurred('medium')` on important actions
- **Loading states** — skeleton loaders for all data-dependent content
- **Error states** — friendly error messages with retry buttons
- **Empty states** — illustrated placeholders for "No orders yet", "No trades yet"
- **Pull-to-refresh** — implement on list pages
- **Animations** — subtle transitions between pages, success checkmarks on completion
- **Safe area** — pad top for Telegram header, bottom for tab bar + device safe area

## Acceptance Criteria

- [ ] Mini App loads inside Telegram without errors
- [ ] Telegram theme colors applied throughout (light and dark mode)
- [ ] Safe areas handled correctly (no content under Telegram header or device notch)
- [ ] TON Connect wallet connection works
- [ ] Order book displays with filtering and sorting
- [ ] Create order form validates input and submits
- [ ] Lock Escrow button triggers TON Connect Jetton transfer
- [ ] Trade page shows correct UI for each status
- [ ] Trade lifecycle: accept → lock → fiat sent → confirm works
- [ ] Profile page shows stats and KYC status
- [ ] KYC page embeds Sumsub SDK (or placeholder)
- [ ] Back button works with Telegram navigation
- [ ] All API calls include Telegram initData auth header
- [ ] `npm run build` produces optimized production bundle

## Signal Completion

Create `/var/www/ibis/.agent-5-complete`:
```
AGENT_5_COMPLETE=true
TIMESTAMP=<ISO>
PAGES=Home,OrderBook,CreateOrder,Trade,MyTrades,Profile,KycVerification
BUILD_SIZE=<dist size in KB>
TON_CONNECT=working|placeholder
KYC_PAGE=working|placeholder
NOTES=<any issues>
```
