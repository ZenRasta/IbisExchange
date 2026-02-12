# Agent 7 Prompt: Integration & End-to-End Testing

## Copy everything below this line into Claude Code:

---

You are the **Integration Agent** for Project Ibis. All other agents have built their components. Your job is to wire everything together, fix integration issues, write E2E tests, create deployment scripts, and verify the complete trade flow works end-to-end on TON testnet.

**Wait for ALL agents:** Check that these files ALL exist:
- `/var/www/ibis/.agent-1-complete`
- `/var/www/ibis/.agent-2-complete`
- `/var/www/ibis/.agent-3-complete`
- `/var/www/ibis/.agent-4-complete`
- `/var/www/ibis/.agent-5-complete`
- `/var/www/ibis/.agent-6-complete`

Read each completion file for addresses, ports, and notes.

## Your Responsibilities

1. **Wire the packages together** — ensure imports resolve, shared types work across packages
2. **Mount all routes** — KYC router into API server, webhook routes
3. **Connect bot ↔ API** — bot notification service calls API endpoints or shares DB
4. **Set environment variables** — escrow contract address from Agent 2, bot token from Agent 3
5. **Build and start all services** — compile TypeScript, start with PM2
6. **Fix any integration bugs** — type mismatches, missing imports, API contract misalignments
7. **Write E2E test script** — simulate complete trade flow
8. **Create deployment scripts** — for production deployment
9. **Write README.md** — setup instructions, architecture overview

## Task Checklist

### 1. Read All Agent Completion Files

```bash
for f in /var/www/ibis/.agent-*-complete; do echo "=== $f ==="; cat $f; echo; done
```

Extract: ESCROW_CONTRACT_ADDRESS, BOT_USERNAME, API_PORT, etc.
Update `/var/www/ibis/.env` with all values.

### 2. Verify Cross-Package Imports

Check that `@ibis/shared` resolves correctly from all packages:
```bash
cd /var/www/ibis
# Ensure workspace links are set up
npm install
# Verify each package can import shared
cd packages/api && npx tsc --noEmit
cd ../bot && npx tsc --noEmit
```

Fix any TypeScript errors. Common issues:
- Missing type exports from shared package
- Prisma client not generated (`cd packages/shared && npx prisma generate`)
- Path aliases not configured in tsconfig

### 3. Mount All Routes in API Server

Verify `packages/api/src/index.ts` includes:
```typescript
import { kycRouter } from './routes/kyc';
app.use('/api/kyc', telegramAuth, kycRouter);
```

Verify webhooks router handles both TON and Sumsub:
```typescript
app.use('/api/webhooks', webhooksRouter); // No auth — self-validating
```

### 4. Connect Bot to API/DB

The bot needs to:
- Send notifications when trade states change (via bot.api.sendMessage)
- The API needs a way to trigger bot notifications

**Option A (simple — shared DB):** Both bot and API import Prisma. API updates DB, bot polls or uses Redis pub/sub.

**Option B (decoupled — Redis pub/sub):** API publishes events to Redis channels, bot subscribes.

Implement Option B:
```typescript
// packages/api/src/services/notificationService.ts
import redis from '@ibis/shared/redis';

export async function publishTradeEvent(event: string, data: any) {
    await redis.publish('trade-events', JSON.stringify({ event, data, timestamp: Date.now() }));
}

// packages/bot/src/services/eventListener.ts
import { createClient } from 'redis';

export function startEventListener(bot: Bot) {
    const sub = createClient({ url: process.env.REDIS_URL });
    sub.connect().then(() => {
        sub.subscribe('trade-events', async (message) => {
            const { event, data } = JSON.parse(message);
            switch (event) {
                case 'escrow_locked': await notifyEscrowLocked(bot, data); break;
                case 'trade_completed': await notifyTradeCompleted(bot, data); break;
                case 'kyc_verified': await notifyKycVerified(bot, data); break;
                // ... etc
            }
        });
    });
}
```

### 5. Build All Packages

```bash
cd /var/www/ibis

# Generate Prisma client
cd packages/shared && npx prisma generate && npx prisma migrate deploy && cd ../..

# Build shared
cd packages/shared && npx tsc && cd ../..

# Build API
cd packages/api && npx tsc && cd ../..

# Build bot
cd packages/bot && npx tsc && cd ../..

# Build Mini App
cd packages/mini-app && npm run build && cd ../..

# Build escrow (compile Tact)
cd packages/escrow && npx blueprint build --all && cd ../..
```

Fix any build errors.

### 6. Start Services

```bash
# Copy Mini App build to Nginx root
cp -r packages/mini-app/dist/* /var/www/ibis-static/ 2>/dev/null || true
# Or update Nginx to point to packages/mini-app/dist

# Start with PM2
pm2 start ecosystem.config.js
pm2 status
pm2 logs --lines 50
```

Verify:
- API responds: `curl http://localhost:3000/api/orders` (should return 401 — needs auth)
- Nginx serves Mini App: `curl http://localhost` (should return HTML)
- Bot is online: check Telegram

### 7. E2E Test Script

Create `/var/www/ibis/scripts/e2e-test.ts`:

```typescript
/**
 * End-to-end test simulating a complete P2P trade flow.
 * Run: npx tsx scripts/e2e-test.ts
 * 
 * This tests the API layer directly (bypassing Telegram auth for testing).
 * For full E2E with Telegram, use the bot manually.
 */

import prisma from '../packages/shared/src/db';

async function main() {
    console.log('🧪 E2E Test: Complete Trade Flow\n');

    // 1. Create test users
    console.log('1. Creating test users...');
    const seller = await prisma.user.upsert({
        where: { telegramId: 100001 },
        update: {},
        create: { telegramId: 100001, firstName: 'TestSeller', username: 'test_seller', tonAddress: 'EQ_SELLER_TEST' },
    });
    const buyer = await prisma.user.upsert({
        where: { telegramId: 100002 },
        update: {},
        create: { telegramId: 100002, firstName: 'TestBuyer', username: 'test_buyer', tonAddress: 'EQ_BUYER_TEST' },
    });
    console.log(`   Seller: ${seller.id}, Buyer: ${buyer.id}`);

    // 2. Create sell order
    console.log('2. Creating sell order...');
    const order = await prisma.order.create({
        data: {
            userId: seller.id, type: 'SELL', amount: 100, remainingAmount: 100,
            pricePerUsdt: 7.10, paymentMethods: ['Republic Bank'],
            bankDetails: 'Republic Bank 170-XXXX-XXXX-X', status: 'ACTIVE',
        },
    });
    console.log(`   Order #${order.id}: ${order.amount} USDT @ ${order.pricePerUsdt} TTD`);

    // 3. Buyer accepts → create trade
    console.log('3. Creating trade (buyer accepts)...');
    const trade = await prisma.trade.create({
        data: {
            orderId: order.id, buyerId: buyer.id, sellerId: seller.id,
            amount: 100, pricePerUsdt: 7.10, fiatAmount: 710,
            fiatCurrency: 'TTD', paymentMethod: 'Republic Bank',
            status: 'AWAITING_ESCROW',
        },
    });
    console.log(`   Trade #${trade.id}: status=${trade.status}`);

    // 4. Simulate escrow lock
    console.log('4. Simulating escrow lock...');
    await prisma.trade.update({ where: { id: trade.id }, data: { status: 'ESCROW_LOCKED', escrowLockedAt: new Date() } });
    console.log('   Status → ESCROW_LOCKED');

    // 5. Buyer confirms fiat sent
    console.log('5. Buyer confirms fiat sent...');
    await prisma.trade.update({ where: { id: trade.id }, data: { status: 'FIAT_SENT', fiatSentAt: new Date(), paymentReference: 'TRD-TEST-001' } });
    console.log('   Status → FIAT_SENT');

    // 6. Seller confirms receipt → complete
    console.log('6. Seller confirms receipt...');
    await prisma.trade.update({ where: { id: trade.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    
    // Update reputation
    for (const userId of [seller.id, buyer.id]) {
        await prisma.user.update({ where: { id: userId },
            data: { totalTrades: { increment: 1 }, totalVolume: { increment: 100 } } });
    }
    console.log('   Status → COMPLETED ✅');

    // 7. Verify final state
    const finalTrade = await prisma.trade.findUnique({ where: { id: trade.id } });
    const finalSeller = await prisma.user.findUnique({ where: { id: seller.id } });
    console.log(`\n✅ Trade completed: ${finalTrade?.status}`);
    console.log(`   Seller trades: ${finalSeller?.totalTrades}, volume: ${finalSeller?.totalVolume} USDT`);

    // Cleanup
    await prisma.trade.delete({ where: { id: trade.id } });
    await prisma.order.delete({ where: { id: order.id } });
    console.log('\n🧹 Test data cleaned up');
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

### 8. Deployment Script

Create `/var/www/ibis/scripts/deploy.sh`:
```bash
#!/bin/bash
set -e
echo "🚀 Deploying Ibis P2P Exchange..."

cd /var/www/ibis
git pull origin main

echo "📦 Installing dependencies..."
npm install

echo "🗄️ Running migrations..."
cd packages/shared && npx prisma migrate deploy && npx prisma generate && cd ../..

echo "🔨 Building packages..."
cd packages/shared && npx tsc && cd ../..
cd packages/api && npx tsc && cd ../..
cd packages/bot && npx tsc && cd ../..
cd packages/mini-app && npm run build && cd ../..

echo "♻️ Restarting services..."
pm2 reload ecosystem.config.js

echo "✅ Deployment complete!"
pm2 status
```

### 9. Write README.md

Create `/var/www/ibis/README.md` with:
- Project overview and architecture diagram
- Prerequisites (Node 22, PostgreSQL 16, Redis 7)
- Setup instructions (step by step)
- Environment variables table
- How to run in development
- How to deploy to production
- How to register the Telegram bot
- How to configure Sumsub KYC
- How to deploy the escrow contract
- API documentation summary

## Acceptance Criteria

- [ ] `npm install` at root succeeds
- [ ] All packages compile without TypeScript errors
- [ ] PM2 starts both api and bot processes without crashes
- [ ] Nginx serves Mini App at /
- [ ] Nginx proxies /api/ to Express
- [ ] E2E test script passes
- [ ] Bot responds to /start in Telegram
- [ ] Mini App opens from bot's menu button
- [ ] .env has all required values populated
- [ ] README.md provides clear setup instructions

## Signal Completion

Create `/var/www/ibis/.agent-7-complete`:
```
AGENT_7_COMPLETE=true
TIMESTAMP=<ISO>
BUILD_STATUS=all_packages_compile
PM2_PROCESSES=ibis-api,ibis-bot
E2E_TEST=pass|fail
INTEGRATION_ISSUES_FIXED=<list>
NOTES=<any remaining issues>
```
