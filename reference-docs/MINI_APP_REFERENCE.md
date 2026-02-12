# MINI_APP_REFERENCE.md — Telegram Mini App + TON Connect Reference

## Stack

- **SDK:** @telegram-apps/sdk-react v3.11.x
- **TON Connect:** @tonconnect/ui-react v2.3.x
- **Build:** Vite 5.4.x + React 18 + Tailwind 3.4.x
- **Router:** react-router-dom v6 + @telegram-apps/react-router-integration

## CRITICAL: Buffer Polyfill

At the VERY TOP of src/index.tsx, BEFORE any other imports:
```typescript
import { Buffer } from 'buffer';
(window as any).Buffer = Buffer;
```
Without this, @ton/core crashes because it uses Node.js Buffer.

## CRITICAL: USDT Decimals

USDT on TON uses 6 decimals. NEVER use `toNano()` for USDT (that's 9 decimals).
```typescript
// WRONG:  toNano('100')     → 100_000_000_000 (9 zeros)
// RIGHT:  BigInt(100 * 1e6) → 100_000_000     (6 zeros)
function usdtToUnits(amount: number): bigint {
    return BigInt(Math.round(amount * 1_000_000));
}
```

## CRITICAL: Safe Areas

Standard `env(safe-area-inset-*)` does NOT work in Telegram WebView.
Use Telegram's own API:
```typescript
import { useSignal, viewport } from '@telegram-apps/sdk-react';
const safeArea = useSignal(viewport.safeAreaInsets);
const contentSafeArea = useSignal(viewport.contentSafeAreaInsets);
// Apply as padding: paddingTop = safeArea.top + contentSafeArea.top
```

## Telegram Theme Colors (CSS Variables)

After calling `themeParams.bindCssVars()`:
```css
--tg-theme-bg-color           /* Main background */
--tg-theme-text-color          /* Primary text */
--tg-theme-hint-color          /* Secondary/muted text */
--tg-theme-link-color          /* Links */
--tg-theme-button-color        /* Primary button background */
--tg-theme-button-text-color   /* Primary button text */
--tg-theme-secondary-bg-color  /* Cards, sections background */
--tg-theme-section-bg-color    /* Section background */
--tg-theme-accent-text-color   /* Accent/highlight */
--tg-theme-destructive-text-color /* Error/danger */
```

NEVER hardcode colors. Always use `var(--tg-theme-*)` or Tailwind `tg-*` classes.

## TON Connect: Sending USDT to Escrow

The message goes to the USER'S USDT Jetton wallet (not the master, not the escrow):
```typescript
import { beginCell, toNano, Address } from '@ton/core';

// 1. Get user's USDT Jetton wallet address
const res = await fetch(`https://tonapi.io/v2/accounts/${userAddr}/jettons/${USDT_MASTER}`);
const jettonWalletAddr = (await res.json()).wallet_address.address;

// 2. Build transfer body
const body = beginCell()
    .storeUint(0xf8a7ea5, 32)          // op: transfer
    .storeUint(0, 64)                    // query_id
    .storeCoins(usdtToUnits(amount))    // USDT amount (6 decimals!)
    .storeAddress(Address.parse(ESCROW)) // destination
    .storeAddress(Address.parse(userAddr)) // response_destination
    .storeUint(0, 1)                     // no custom_payload
    .storeCoins(toNano('0.05'))          // forward_ton_amount (triggers notification)
    .storeBit(1)                         // forward_payload as ref
    .storeRef(beginCell().storeUint(escrowId, 64).endCell()) // escrow ID
    .endCell();

// 3. Send via TON Connect
const result = await tonConnectUI.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    messages: [{
        address: jettonWalletAddr,           // USER's Jetton wallet!
        amount: toNano('0.1').toString(),     // TON for gas
        payload: body.toBoc().toString('base64'),
    }],
});
```

## API Authentication from Mini App

Every API call must include the raw Telegram initData:
```typescript
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';
const lp = retrieveLaunchParams();

fetch('/api/endpoint', {
    headers: { 'X-Telegram-Init-Data': lp.initDataRaw || '' }
});
```

## Registering with BotFather

1. `/mybots` → select bot → Bot Settings → Configure Mini App → Enable
2. Enter HTTPS URL of the Mini App
3. `/setmenubutton` → enter URL → enter button title

## Useful Links

- TMA SDK docs: https://docs.telegram-mini-apps.com
- TON Connect React: https://docs.ton.org/v3/guidelines/ton-connect/frameworks/react
- TON Connect Jetton transfer: https://docs.ton.org/v3/guidelines/ton-connect/cookbook/jetton-transfer
- USDT demo Mini App: https://github.com/ton-community/tma-usdt-payments-demo
