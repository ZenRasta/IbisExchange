# Agent 4 Prompt: Matching Engine & REST API

## Copy everything below this line into Claude Code as the initial instruction:

---

You are the **Matching Engine Agent** for Project Ibis — a Telegram-based P2P USDT exchange. Your job is to build the Express REST API server with the order book management, trade matching logic, reputation system, and TON blockchain monitoring service.

**Read the reference doc first:** `/var/www/ibis/reference-docs/MATCHING_ENGINE_REFERENCE.md`

**Wait for Agent 1:** Check that `/var/www/ibis/.agent-1-complete` exists before starting.

## Your Workspace

`/var/www/ibis/packages/api/`

## Your Responsibilities

You own:
- `src/index.ts` — Express server setup, middleware, route mounting
- `src/routes/orders.ts` — Order CRUD endpoints
- `src/routes/trades.ts` — Trade lifecycle endpoints
- `src/routes/users.ts` — User profile and stats endpoints
- `src/routes/webhooks.ts` — TON transaction webhook receiver
- `src/middleware/telegramAuth.ts` — Validate Telegram initData on every request
- `src/middleware/rateLimiter.ts` — Redis-based rate limiting
- `src/services/matchingEngine.ts` — Order matching and trade creation logic
- `src/services/tonMonitor.ts` — Monitor escrow for USDT deposits and releases
- `src/services/reputationService.ts` — Reputation scoring after trades
- `src/services/notificationService.ts` — Bridge to send bot notifications via API

You do NOT touch:
- Bot conversation flows (Agent 3)
- Smart contract code (Agent 2)
- Mini App frontend (Agent 5)
- KYC verification logic (Agent 6) — but you provide the KYC route mount point

## Task Checklist

### 1. Install Dependencies

```bash
cd /var/www/ibis/packages/api
npm install express cors helmet compression express-rate-limit
npm install @prisma/client redis @ton/ton @ton/core
npm install -D typescript @types/node @types/express ts-node-dev
```

### 2. Express Server (`src/index.ts`)

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { ordersRouter } from './routes/orders';
import { tradesRouter } from './routes/trades';
import { usersRouter } from './routes/users';
import { webhooksRouter } from './routes/webhooks';
import { telegramAuth } from './middleware/telegramAuth';

const app = express();
app.use(helmet());
app.use(compression());
app.use(cors({ origin: process.env.MINI_APP_URL }));
app.use(express.json());

// Webhook routes (no auth — they have their own verification)
app.use('/api/webhooks', webhooksRouter);

// Authenticated routes (Telegram initData required)
app.use('/api/orders', telegramAuth, ordersRouter);
app.use('/api/trades', telegramAuth, tradesRouter);
app.use('/api/users', telegramAuth, usersRouter);
// KYC routes will be mounted by Agent 6:
// app.use('/api/kyc', telegramAuth, kycRouter);

app.listen(Number(process.env.PORT) || 3000);
```

### 3. Telegram Auth Middleware (`src/middleware/telegramAuth.ts`)

**Every Mini App request must include Telegram initData for authentication.**

```typescript
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export function telegramAuth(req: Request, res: Response, next: NextFunction) {
    const initData = req.headers['x-telegram-init-data'] as string;
    if (!initData) return res.status(401).json({ error: 'Missing initData' });

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return res.status(401).json({ error: 'Missing hash' });

    params.delete('hash');
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData')
        .update(process.env.BOT_TOKEN!).digest();
    const computed = crypto.createHmac('sha256', secretKey)
        .update(dataCheckString).digest('hex');

    if (computed !== hash) return res.status(401).json({ error: 'Invalid signature' });

    // Check not expired (24 hour window)
    const authDate = parseInt(params.get('auth_date') || '0');
    if (Math.floor(Date.now() / 1000) - authDate > 86400)
        return res.status(401).json({ error: 'Expired' });

    const userParam = params.get('user');
    if (!userParam) return res.status(401).json({ error: 'No user data' });

    req.telegramUser = JSON.parse(decodeURIComponent(userParam));
    next();
}

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            telegramUser?: {
                id: number;
                first_name: string;
                last_name?: string;
                username?: string;
                language_code?: string;
                is_premium?: boolean;
            };
        }
    }
}
```

### 4. Order Routes (`src/routes/orders.ts`)

**GET `/api/orders`** — List active orders
- Query params: `type` (BUY|SELL), `minAmount`, `maxAmount`, `paymentMethod`, `page`, `limit`
- Return: paginated list of orders with seller/buyer info, reputation, KYC status
- Sort by: price (best first), then reputation, then created_at

**POST `/api/orders`** — Create new order
- Body: `{ type: 'SELL'|'BUY', amount: number, pricePerUsdt: number, paymentMethods: string[], bankDetails: string, minTradeAmount?: number, maxTradeAmount?: number }`
- Validate: amount within limits (check KYC status for max), price reasonable, at least one payment method
- Enforce: unverified users max 500 USDT, verified users max 10,000 USDT
- Create order in DB with status ACTIVE

**GET `/api/orders/:id`** — Get single order with seller details

**PATCH `/api/orders/:id`** — Update own order (price, amount, status)
- Only owner can update
- Can cancel (set status CANCELLED)
- Can update price while active

**DELETE `/api/orders/:id`** — Cancel own order (soft delete — set status CANCELLED)

### 5. Trade Routes (`src/routes/trades.ts`)

**POST `/api/trades`** — Accept an order (create trade)
- Body: `{ orderId: string }`
- Validate: order is active, buyer != seller, buyer within trade limits
- Create trade with status AWAITING_ESCROW
- Reduce order's available amount (or mark MATCHED if fully consumed)
- Return: trade details including seller's bank info

**GET `/api/trades`** — List user's trades
- Query params: `status`, `page`, `limit`
- Return: trades where user is buyer or seller

**GET `/api/trades/:id`** — Single trade detail

**POST `/api/trades/:id/escrow-locked`** — Backend confirms escrow was funded
- Called after TON monitor detects USDT deposit to escrow
- Update status to ESCROW_LOCKED
- Trigger bot notification to buyer (send seller's bank details)

**POST `/api/trades/:id/fiat-sent`** — Buyer confirms fiat payment
- Body: `{ paymentReference?: string }`
- Only buyer can call
- Update status to FIAT_SENT, store reference
- Trigger bot notification to seller
- Start 6-hour timeout in Redis: `SET trade:timeout:<id> <timestamp> EX 21600`

**POST `/api/trades/:id/confirm-receipt`** — Seller confirms fiat received
- Only seller can call
- Update status to RELEASING
- Call TON service to trigger escrow release
- After release confirmed: status → COMPLETED
- Update reputation for both parties

**POST `/api/trades/:id/dispute`** — Open dispute
- Body: `{ reason: string }`
- Either party can call
- Update status to DISPUTED
- Trigger bot notification to both + admin

**POST `/api/trades/:id/resolve`** — Admin resolves dispute
- Body: `{ resolution: 'RELEASE' | 'REFUND' }`
- Only admin/arbiter can call (check Telegram user ID against admin list)
- Trigger escrow release or refund
- Update status accordingly

**POST `/api/trades/:id/cancel`** — Cancel trade (before escrow locked only)
- Either party can cancel if status is AWAITING_ESCROW
- Return order amount to available pool

### 6. User Routes (`src/routes/users.ts`)

**GET `/api/users/me`** — Get current user profile
- Return: user data, trade stats, reputation, KYC status, trade limits

**PUT `/api/users/me`** — Update profile
- Body: `{ displayName?, tonAddress? }`
- `tonAddress` is set when user connects wallet via TON Connect

**GET `/api/users/:id/reputation`** — Get user's public reputation
- Return: trade count, success rate, avg rating, KYC verified badge

### 7. Matching Engine Service (`src/services/matchingEngine.ts`)

```typescript
export class MatchingEngine {
    // Find best matching orders for a buy request
    async findBestSellOrders(amount: number, paymentMethod?: string): Promise<Order[]>

    // Create a trade from an order acceptance
    async createTrade(orderId: string, buyerTgId: number): Promise<Trade>

    // Handle partial fills (order for 500 USDT, buyer wants 200)
    async partialFill(orderId: string, amount: number, buyerTgId: number): Promise<Trade>

    // Auto-expire stale orders (older than 24 hours with no activity)
    async expireStaleOrders(): Promise<number>

    // Timeout handler — called by Redis keyspace notification or cron
    async handleEscrowTimeout(tradeId: string): Promise<void>
    async handleFiatTimeout(tradeId: string): Promise<void>
}
```

### 8. TON Monitor Service (`src/services/tonMonitor.ts`)

Monitors the escrow contract for incoming USDT transfers:

```typescript
import { TonClient, Address } from '@ton/ton';

export class TonMonitor {
    private client: TonClient;
    private escrowAddress: string;
    private lastProcessedLt: string = '0';

    constructor() {
        this.client = new TonClient({
            endpoint: process.env.TON_TESTNET
                ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
                : 'https://toncenter.com/api/v2/jsonRPC',
            apiKey: process.env.TONCENTER_API_KEY,
        });
        this.escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS!;
    }

    // Poll every 5 seconds for new transactions
    async startPolling(): Promise<void>

    // Parse Jetton transfer notifications from transaction list
    async processTransaction(tx: any): Promise<void>

    // Match deposit to pending trade by forward_payload (contains escrow ID)
    async matchDepositToTrade(escrowId: number, amount: bigint, sender: string): Promise<void>

    // Verify escrow release completed (after seller confirms)
    async verifyRelease(tradeId: string): Promise<boolean>
}
```

**Alternative (preferred for production):** Use TonAPI webhooks instead of polling:
```typescript
// Register webhook for escrow contract transactions
// POST https://rt.tonapi.io/webhooks with escrow Jetton wallet address
// Receive POST to /api/webhooks/ton with transaction data
```

Implement BOTH approaches:
- Polling as fallback (always running)
- Webhook handler in routes/webhooks.ts for real-time notifications

### 9. Reputation Service (`src/services/reputationService.ts`)

```typescript
export class ReputationService {
    // Update after completed trade
    async recordCompletedTrade(trade: Trade): Promise<void> {
        // Increment trade count for both parties
        // Update total volume
        // Recalculate reputation score:
        //   score = (completedTrades / totalTrades) * 5
        //   weighted by volume (higher volume trades count more)
    }

    // Update after dispute
    async recordDispute(trade: Trade, loser: 'buyer' | 'seller'): Promise<void>

    // Get user reputation summary
    async getReputation(userId: string): Promise<ReputationSummary>

    // Check if user can trade given amount (based on reputation + KYC)
    async checkTradeLimit(userId: string, amount: number): Promise<{ allowed: boolean; maxAmount: number; reason?: string }>
}
```

### 10. Rate Limiter Middleware

```typescript
import { createClient } from 'redis';

export function rateLimiter(opts: { windowMs: number; max: number; keyPrefix: string }) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const key = `${opts.keyPrefix}:${req.telegramUser?.id || req.ip}`;
        // Sliding window rate limiting with Redis
        // Return 429 with Retry-After header if exceeded
    };
}

// Usage:
app.use('/api/orders', rateLimiter({ windowMs: 60000, max: 30, keyPrefix: 'rl:orders' }));
app.use('/api/trades', rateLimiter({ windowMs: 60000, max: 20, keyPrefix: 'rl:trades' }));
```

## API Contract Summary (for Agent 5 — Mini App)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/orders | TG initData | List orders (paginated) |
| POST | /api/orders | TG initData | Create order |
| GET | /api/orders/:id | TG initData | Get order |
| PATCH | /api/orders/:id | TG initData | Update order |
| DELETE | /api/orders/:id | TG initData | Cancel order |
| POST | /api/trades | TG initData | Accept order → create trade |
| GET | /api/trades | TG initData | List my trades |
| GET | /api/trades/:id | TG initData | Get trade |
| POST | /api/trades/:id/fiat-sent | TG initData | Buyer confirms fiat |
| POST | /api/trades/:id/confirm-receipt | TG initData | Seller confirms receipt |
| POST | /api/trades/:id/dispute | TG initData | Open dispute |
| GET | /api/users/me | TG initData | My profile |
| PUT | /api/users/me | TG initData | Update profile |
| POST | /api/webhooks/ton | TON signature | TON transaction webhook |
| POST | /api/webhooks/veriff | HMAC sig | Veriff KYC webhook |

**All authenticated endpoints expect header:** `X-Telegram-Init-Data: <raw initData string>`

**All responses follow format:**
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Error message", "code": "ERROR_CODE" }
```

## Acceptance Criteria

- [ ] Express server starts and responds on port 3000
- [ ] Telegram initData authentication works correctly
- [ ] All CRUD endpoints for orders work
- [ ] Trade lifecycle endpoints work (create → escrow → fiat → complete)
- [ ] TON polling monitor detects escrow deposits
- [ ] Webhook endpoint receives and validates TON notifications
- [ ] Rate limiting prevents abuse
- [ ] Reputation scores update after trades
- [ ] Trade limits enforced based on KYC status
- [ ] Partial order fills work correctly
- [ ] API contract matches the table above exactly

## Signal Completion

Create `/var/www/ibis/.agent-4-complete`:
```
AGENT_4_COMPLETE=true
TIMESTAMP=<ISO>
API_PORT=3000
ENDPOINTS_COUNT=<number>
TON_MONITOR=polling|webhook|both
NOTES=<any issues>
```
