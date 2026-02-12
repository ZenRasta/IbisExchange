# MATCHING_ENGINE_REFERENCE.md — API & Trade Engine Reference

## Stack

- **Server:** Express 4.18.x on Node.js 22
- **ORM:** Prisma 6.x (schema in packages/shared)
- **Cache/Queue:** Redis 7 via node redis client
- **TON Client:** @ton/ton v16.x

## API Authentication

Every authenticated endpoint receives the Telegram initData in the `X-Telegram-Init-Data` header.

**Validation algorithm:**
1. Parse as URLSearchParams
2. Extract and remove `hash`
3. Sort remaining params alphabetically
4. Create data_check_string: `key=value\nkey=value\n...`
5. Secret key: HMAC-SHA256("WebAppData", BOT_TOKEN)
6. Computed hash: HMAC-SHA256(secret_key, data_check_string)
7. Compare computed hash to extracted hash
8. Check auth_date is within 24 hours

After validation, `req.telegramUser` contains: `{ id, first_name, last_name?, username? }`

## Order Matching Logic

Simple price-time priority:
1. Best price first (lowest price for sells, highest for buys)
2. Oldest order first (FIFO within same price)
3. Filter by: payment method match, amount range overlap

**Partial fills:** An order for 500 USDT can be consumed by multiple trades. Track `remainingAmount`. When remainingAmount reaches 0, set status to MATCHED.

## TON Transaction Monitoring

**Polling approach (simpler, good for POC):**
```typescript
import { TonClient } from '@ton/ton';
const client = new TonClient({ endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC', apiKey: KEY });

// Poll every 5 seconds
setInterval(async () => {
    const txs = await client.getTransactions(escrowAddress, { limit: 10 });
    for (const tx of txs) {
        if (tx.lt > lastProcessedLt) {
            // Parse transaction, check for Jetton transfer notification
            // Match to pending trade
            lastProcessedLt = tx.lt;
        }
    }
}, 5000);
```

**TonAPI webhook approach (better for production):**
- Register at tonconsole.com
- POST `https://rt.tonapi.io/webhooks` to create webhook
- Subscribe escrow's Jetton wallet address
- Receive POST to your endpoint when transactions occur

## Redis Key Patterns

```
session:<telegram_id>         — Bot session data (JSON, 30min TTL)
trade:timeout:<trade_id>      — Escrow funding timeout (30min TTL)
trade:fiat_timeout:<trade_id> — Fiat confirmation timeout (6hr TTL)
rl:orders:<telegram_id>       — Rate limit counter for order endpoints
rl:trades:<telegram_id>       — Rate limit counter for trade endpoints
trade-events                  — Redis pub/sub channel for bot notifications
```

## Response Format

All API responses follow:
```json
{ "success": true, "data": { ... }, "pagination": { "page": 1, "limit": 20, "total": 45 } }
{ "success": false, "error": "Human-readable message", "code": "ERROR_CODE" }
```

Error codes: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `TRADE_LIMIT_EXCEEDED`, `ORDER_NOT_ACTIVE`, `INSUFFICIENT_BALANCE`, `RATE_LIMITED`, `INTERNAL_ERROR`

## Trade Lifecycle State Machine

```
create trade → AWAITING_ESCROW
lock USDT    → ESCROW_LOCKED    (detected by TON monitor)
buyer pays   → FIAT_SENT        (buyer action)
seller acks  → RELEASING         (triggers escrow release)
release done → COMPLETED         (detected by TON monitor)
dispute      → DISPUTED          (either party)
resolve      → RESOLVED_RELEASE or RESOLVED_REFUND (admin)
```

## Environment Variables Used

```
PORT, DATABASE_URL, REDIS_URL, BOT_TOKEN, TONCENTER_API_KEY, TONAPI_KEY,
ESCROW_CONTRACT_ADDRESS, USDT_MASTER_ADDRESS, MINI_APP_URL, ADMIN_TELEGRAM_IDS
```
