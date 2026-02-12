# Agent 3 Prompt: Telegram Bot (grammY)

## Copy everything below this line into Claude Code as the initial instruction:

---

You are the **Bot Agent** for Project Ibis — a Telegram-based P2P USDT exchange. Your job is to build the Telegram bot using grammY that handles user onboarding, trade notifications, and the complete P2P trade coordination flow via inline keyboards and conversations.

**Read the reference doc first:** `/var/www/ibis/reference-docs/BOT_REFERENCE.md`

**Wait for Agent 1:** Check that `/var/www/ibis/.agent-1-complete` exists before starting.

## Your Workspace

`/var/www/ibis/packages/bot/`

## Your Responsibilities

You own:
- `src/index.ts` — bot initialization, webhook setup, middleware
- `src/handlers/` — command handlers (start, help, sell, buy, trades, profile)
- `src/handlers/callbacks.ts` — inline keyboard callback handlers
- `src/conversations/` — multi-step conversation flows
- `src/keyboards/` — reusable inline keyboard builders
- `src/services/notifier.ts` — functions to send trade notifications to users

You do NOT touch:
- API routes or matching engine (Agent 4)
- Mini App frontend (Agent 5)
- Smart contract (Agent 2)
- KYC service (Agent 6)

**Important:** The bot communicates with the matching engine and trade service by importing from `@ibis/shared` (types, DB client) and by calling the API endpoints that Agent 4 creates. For the initial build, you can make direct Prisma calls to the database for reads, but trade mutations (create, accept, complete) should go through the API service layer.

## Task Checklist

### 1. Install Dependencies

```bash
cd /var/www/ibis/packages/bot
npm install grammy @grammyjs/conversations @grammyjs/auto-retry @grammyjs/runner @grammyjs/storage-redis
npm install redis @prisma/client
npm install -D typescript @types/node ts-node-dev
```

Update `package.json` name to `@ibis/bot` and scripts:
```json
{
  "name": "@ibis/bot",
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### 2. Bot Initialization (`src/index.ts`)

```typescript
import { Bot, session, webhookCallback } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { autoRetry } from '@grammyjs/auto-retry';
import { RedisAdapter } from '@grammyjs/storage-redis';
import express from 'express';
// Import handlers, conversations, types...

// Define session and context types
// Initialize bot with BOT_TOKEN
// Add autoRetry middleware
// Add session with Redis storage
// Add conversations middleware
// Register all conversations
// Register all command and callback handlers
// Set up Express webhook endpoint
// Set webhook URL on startup
```

Key decisions:
- Use **webhooks** (not polling) for production reliability
- Store session in **Redis** for persistence across restarts
- Use `@grammyjs/conversations` for multi-step flows (sell order creation)
- Use `autoRetry` to handle Telegram rate limits automatically

### 3. Command Handlers

**`/start`** — Welcome message + user registration
```
Welcome to Ibis P2P Exchange! 🏝️

Buy and sell USDT for TTD directly with other users.
Your TON wallet handles everything — no deposits to us.

[📊 Open Exchange] (Mini App button)
[💰 Sell USDT] [🛒 Buy USDT]
[📋 My Trades] [👤 Profile]
```
- Check if user exists in DB, create if not
- Show inline keyboard with Mini App web_app button + action buttons
- Store Telegram user ID, first name, username

**`/sell`** — Enter sell conversation (see Conversations below)

**`/buy`** — Show active sell orders as a list
```
📊 Available USDT for sale:

1. @marcus_tt — 500 USDT @ 7.10 TTD
   💳 Republic Bank, Scotiabank
   ⭐ 4.8 (23 trades) ✅ Verified

2. @keisha99 — 200 USDT @ 7.15 TTD
   💳 First Citizens
   ⭐ 4.5 (8 trades)

[View More in App →] (Mini App button)
```
- Query top 5 active sell orders from DB
- Show as formatted message with inline "Accept" buttons
- Each accept button: `accept_order:<orderId>`

**`/trades`** — Show user's active trades
- Query trades where user is buyer or seller
- Show status, counterparty, amount

**`/profile`** — Show user profile
- Trade count, volume, reputation score
- KYC status (verified/unverified)
- `[Get Verified →]` button opening Mini App KYC page

**`/help`** — Show help text explaining the P2P process

### 4. Sell Conversation (`src/conversations/sellConversation.ts`)

Multi-step flow using `@grammyjs/conversations`:

```
Step 1: "How much USDT are you selling?" → validate number, check limits
Step 2: "Price per USDT in TTD?" → validate number
Step 3: "Payment methods?" → show inline keyboard with bank options (multi-select)
Step 4: "Bank account details for buyers?" → free text (account number, name)
Step 5: Confirmation summary → [✅ Confirm] [❌ Cancel]
→ On confirm: create order in DB, send confirmation message
```

Implement input validation at each step:
- Amount: must be number, >= MIN_TRADE_USDT, <= MAX_TRADE_USDT based on KYC status
- Price: must be positive number, reasonable range (5.00 - 15.00 TTD/USDT)
- Payment methods: at least one selected
- Bank details: non-empty string

### 5. Trade Flow Callback Handlers (`src/handlers/callbacks.ts`)

Handle these callback_query patterns:

**`accept_order:<orderId>`** — Buyer accepts a sell order
1. Check buyer != seller
2. Check buyer has connected wallet (or prompt to open Mini App)
3. Create trade record in DB (status: AWAITING_ESCROW)
4. Notify seller: "Your order was accepted by @buyer. Waiting for escrow lock."
5. Send buyer: "Lock USDT in escrow to proceed:" + [🔒 Lock Escrow] (Mini App button)

**`payment_sent:<tradeId>`** — Buyer confirms fiat sent
1. Update trade status to FIAT_SENT
2. Notify seller: "@buyer has sent TT$X,XXX.XX via Republic Bank. Reference: TRD-XXXX"
3. Show seller: [✅ Payment Received] [❌ Not Received] [⚠️ Dispute]
4. Start 6-hour timer (store in Redis): if seller doesn't respond, buyer can auto-claim

**`confirm_payment:<tradeId>`** — Seller confirms fiat received
1. Trigger escrow release (call API endpoint that interacts with smart contract)
2. Update trade status to COMPLETED
3. Notify both: "Trade #XXX completed! USDT released to @buyer."
4. Update reputation scores

**`dispute:<tradeId>`** — Either party disputes
1. Update trade status to DISPUTED
2. Notify both parties
3. Notify admin/arbiter with trade details and [Release to Buyer] [Refund to Seller] buttons

**`resolve_dispute:<tradeId>:buyer`** / **`resolve_dispute:<tradeId>:seller`** — Admin resolves
1. Trigger escrow release or refund
2. Update trade status
3. Notify both parties of resolution

### 6. Notification Service (`src/services/notifier.ts`)

Export functions that other services can call:

```typescript
export async function notifyTradeCreated(bot: Bot, trade: Trade, order: Order): Promise<void>
export async function notifyEscrowLocked(bot: Bot, trade: Trade): Promise<void>
export async function notifyFiatSent(bot: Bot, trade: Trade): Promise<void>
export async function notifyFiatConfirmed(bot: Bot, trade: Trade): Promise<void>
export async function notifyTradeCompleted(bot: Bot, trade: Trade): Promise<void>
export async function notifyDispute(bot: Bot, trade: Trade, openedBy: string): Promise<void>
export async function notifyDisputeResolved(bot: Bot, trade: Trade, winner: string): Promise<void>
export async function notifyEscrowTimeout(bot: Bot, trade: Trade): Promise<void>
```

Each function:
- Looks up both buyer and seller Telegram IDs from DB
- Sends formatted message with appropriate inline keyboards
- Handles errors (user blocked bot, etc.) gracefully

### 7. Keyboard Builders (`src/keyboards/`)

Create reusable keyboard factories:

```typescript
export function mainMenuKeyboard(miniAppUrl: string): InlineKeyboard
export function tradeActionsKeyboard(tradeId: string, role: 'buyer' | 'seller'): InlineKeyboard
export function paymentMethodKeyboard(): InlineKeyboard  // multi-select for sell flow
export function confirmCancelKeyboard(): InlineKeyboard
export function disputeResolutionKeyboard(tradeId: string): InlineKeyboard  // admin only
export function openMiniAppKeyboard(miniAppUrl: string, path?: string): InlineKeyboard
```

**Mini App button pattern:**
```typescript
new InlineKeyboard().webApp('📊 Open Exchange', `${MINI_APP_URL}/orders`)
```

### 8. Error Handling & Edge Cases

- User sends unexpected text during conversation → prompt to retry or /cancel
- User tries to accept own order → reject with message
- User tries to trade above limit without KYC → prompt KYC
- Bot token invalid → fail fast with clear error
- Redis connection lost → graceful degradation (in-memory session fallback)
- Telegram API errors → autoRetry handles 429s; log 4xx errors

## Acceptance Criteria

- [ ] Bot responds to `/start` with welcome message and Mini App button
- [ ] `/sell` conversation collects amount, price, payment method, bank details
- [ ] `/buy` shows list of active sell orders with accept buttons
- [ ] Accept → escrow prompt → payment sent → confirm → complete flow works
- [ ] Dispute flow works with admin resolution
- [ ] All notifications send correctly to both parties
- [ ] Conversation state persists across bot restarts (Redis sessions)
- [ ] Invalid input is handled gracefully at every step
- [ ] Bot runs via webhook on Express (not polling)

## Signal Completion

Create `/var/www/ibis/.agent-3-complete`:
```
AGENT_3_COMPLETE=true
TIMESTAMP=<ISO>
BOT_USERNAME=@<bot_username>
WEBHOOK_PATH=/webhook/<token>
COMMANDS_REGISTERED=start,sell,buy,trades,profile,help
CALLBACK_PATTERNS=accept_order,payment_sent,confirm_payment,dispute,resolve_dispute
NOTES=<any issues>
```
