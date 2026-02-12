# Project Ibis — Master Work Plan for Claude Code Agent Teams

## TTD↔USDT P2P Exchange on Telegram + TON Blockchain

**Date:** February 8, 2026
**VM:** Digital Ocean Ubuntu 24.04 — 4GB RAM / 2 vCPUs
**Repo root:** `/var/www/ibis`

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      TELEGRAM CLIENT                             │
│  ┌──────────────┐   ┌─────────────────┐   ┌──────────────────┐ │
│  │ grammY Bot    │   │ TON Wallet      │   │ Mini App (React) │ │
│  │ (trade flow,  │   │ (built-in USDT, │   │ (order book,     │ │
│  │  notifications│   │  self-custodial)│   │  trade UI, KYC)  │ │
│  │  inline kbd)  │   │                 │   │  + TON Connect   │ │
│  └──────┬───────┘   └────────┬────────┘   └───────┬──────────┘ │
└─────────┼────────────────────┼─────────────────────┼────────────┘
          │ webhook             │ Jetton txs          │ HTTPS
          ▼                    ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Node.js + Express)                   │
│  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌──────────────────┐│
│  │ Bot       │  │ Trade    │  │ TON     │  │ KYC Service      ││
│  │ Handler   │  │ Matching │  │ Monitor │  │ (Sumsub API)     ││
│  │           │  │ Engine   │  │         │  │                  ││
│  └─────┬────┘  └────┬─────┘  └────┬────┘  └───────┬──────────┘│
│        └─────────────┴─────────────┴───────────────┘            │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│        ┌──────────┐   ┌──────────┐   ┌─────────────┐          │
│        │PostgreSQL│   │  Redis   │   │ TON Network │          │
│        │  16      │   │  7       │   │ (escrow     │          │
│        │          │   │          │   │  contract)  │          │
│        └──────────┘   └──────────┘   └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Agent Team Definitions

| Agent # | Name | Scope | Est. Time |
|---------|------|-------|-----------|
| 1 | **Infra Agent** | VM setup, PostgreSQL, Redis, Nginx, PM2, SSL, monorepo scaffold | 2-3 hrs |
| 2 | **TON Escrow Agent** | Tact escrow contract, Blueprint tests, testnet deploy | 4-6 hrs |
| 3 | **Bot Agent** | grammY Telegram bot, trade coordination, notifications | 4-6 hrs |
| 4 | **Matching Engine Agent** | Order book, trade matching, reputation, API routes | 3-4 hrs |
| 5 | **Mini App UI Agent** | React + Tailwind Telegram Mini App, TON Connect | 5-7 hrs |
| 6 | **KYC Agent** | Sumsub integration, webhook handler, verification flow | 3-4 hrs |
| 7 | **Integration Agent** | Wire everything together, E2E testing, deploy scripts | 3-4 hrs |

**Total estimated build time: 24-34 hours of agent compute**
**Critical path: Agent 1 → Agents 2,3,4,6 (parallel) → Agent 5 → Agent 7**

---

## Execution Order and Dependencies

```
Phase 1 (Sequential — must complete first):
  Agent 1: Infrastructure
    └── Sets up VM, DB, Redis, Nginx, monorepo structure
    └── Creates shared .env template and DB schemas
    └── All other agents depend on this completing first

Phase 2 (Parallel — all can run simultaneously):
  Agent 2: TON Escrow     (needs: monorepo structure from Phase 1)
  Agent 3: Bot             (needs: DB schema from Phase 1)
  Agent 4: Matching Engine (needs: DB schema from Phase 1)
  Agent 6: KYC             (needs: DB schema from Phase 1)

Phase 3 (Sequential — needs Phase 2 outputs):
  Agent 5: Mini App UI
    └── Needs: API routes from Agent 4
    └── Needs: Escrow contract address from Agent 2
    └── Needs: Bot username from Agent 3
    └── Needs: KYC access token endpoint from Agent 6

Phase 4 (Sequential — final integration):
  Agent 7: Integration
    └── Needs: All agents complete
    └── Wires bot ↔ matching engine ↔ escrow ↔ mini app
    └── Runs E2E tests on testnet
```

---

## Monorepo Structure (Created by Agent 1)

```
/var/www/ibis/
├── README.md
├── .env.example
├── .env                          # Real secrets (gitignored)
├── package.json                  # Root workspace config
├── docker-compose.yml            # Local dev (PostgreSQL + Redis)
├── ecosystem.config.js           # PM2 production config
│
├── packages/
│   ├── shared/                   # Shared types, constants, DB client
│   │   ├── src/
│   │   │   ├── types.ts          # Trade, Order, User types
│   │   │   ├── constants.ts      # USDT address, fee %, timeouts
│   │   │   ├── db.ts             # Prisma client
│   │   │   └── redis.ts          # Redis client
│   │   ├── prisma/
│   │   │   └── schema.prisma     # Database schema
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── bot/                      # Telegram bot (grammY)
│   │   ├── src/
│   │   │   ├── index.ts          # Bot entry point
│   │   │   ├── conversations/    # Trade flows
│   │   │   ├── handlers/         # Command + callback handlers
│   │   │   ├── keyboards/        # Inline keyboard builders
│   │   │   └── services/         # Business logic
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api/                      # Express REST API
│   │   ├── src/
│   │   │   ├── index.ts          # Server entry point
│   │   │   ├── routes/           # API route handlers
│   │   │   │   ├── orders.ts     # Order CRUD
│   │   │   │   ├── trades.ts     # Trade management
│   │   │   │   ├── users.ts      # User profile
│   │   │   │   ├── kyc.ts        # KYC endpoints
│   │   │   │   └── webhooks.ts   # Sumsub + TON webhooks
│   │   │   ├── middleware/       # Auth, validation, rate limiting
│   │   │   │   ├── telegramAuth.ts
│   │   │   │   └── rateLimiter.ts
│   │   │   └── services/         # Matching engine, TON monitor, KYC
│   │   │       ├── matchingEngine.ts
│   │   │       ├── tonMonitor.ts
│   │   │       ├── sumsubService.ts
│   │   │       └── notificationService.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mini-app/                 # React + Tailwind Mini App
│   │   ├── public/
│   │   │   └── tonconnect-manifest.json
│   │   ├── src/
│   │   │   ├── index.tsx
│   │   │   ├── App.tsx
│   │   │   ├── pages/
│   │   │   │   ├── Home.tsx
│   │   │   │   ├── OrderBook.tsx
│   │   │   │   ├── CreateOrder.tsx
│   │   │   │   ├── Trade.tsx
│   │   │   │   ├── KycVerification.tsx
│   │   │   │   └── Profile.tsx
│   │   │   ├── components/
│   │   │   │   ├── LockEscrow.tsx
│   │   │   │   ├── TradeCard.tsx
│   │   │   │   ├── OrderRow.tsx
│   │   │   │   └── VerificationBadge.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useApi.ts
│   │   │   │   ├── useTrade.ts
│   │   │   │   └── useUser.ts
│   │   │   └── lib/
│   │   │       ├── api.ts
│   │   │       ├── ton.ts
│   │   │       └── telegram.ts
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   ├── index.html
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── escrow/                   # Tact smart contract
│       ├── contracts/
│       │   └── JettonEscrow.tact
│       ├── tests/
│       │   └── JettonEscrow.spec.ts
│       ├── scripts/
│       │   └── deployJettonEscrow.ts
│       ├── tact.config.json
│       ├── blueprint.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── reference-docs/               # Agent reference files
│   ├── ARCHITECTURE.md
│   ├── TON_ESCROW_REFERENCE.md
│   ├── BOT_REFERENCE.md
│   ├── MATCHING_ENGINE_REFERENCE.md
│   ├── MINI_APP_REFERENCE.md
│   ├── KYC_REFERENCE.md
│   └── DATABASE_SCHEMA.md
│
└── scripts/
    ├── setup-vm.sh               # VM provisioning
    ├── deploy.sh                 # Production deploy
    └── seed-testdata.ts          # Test data seeder
```

---

## How to Use This Plan

### For each agent:

1. **Read the agent prompt** from `agent-prompts/AGENT_N_PROMPT.md`
2. **Read the reference doc** from `reference-docs/<RELEVANT>.md`
3. **Start Claude Code** on the Digital Ocean VM
4. **Paste the agent prompt** as the initial instruction
5. **Point it to the reference doc path** on disk

### Agent prompts contain:
- Role description and boundaries
- Exact file paths to create
- Complete task checklist with acceptance criteria
- Code patterns and examples
- What NOT to touch (other agents' territory)
- How to signal completion

### Reference docs contain:
- API documentation, package versions, code examples
- Database schemas and type definitions
- Security requirements and validation rules
- Integration contracts (how this component talks to others)

---

## Shared Constants (All Agents Reference)

```typescript
// packages/shared/src/constants.ts
export const USDT_MASTER_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
export const USDT_DECIMALS = 6;
export const PLATFORM_FEE_PERCENT = 1; // 1% fee on trades
export const ESCROW_TIMEOUT_SECONDS = 21600; // 6 hours
export const ESCROW_FUNDING_TIMEOUT = 1800; // 30 minutes
export const MIN_TRADE_USDT = 10;
export const MAX_TRADE_USDT_UNVERIFIED = 500;
export const MAX_TRADE_USDT_VERIFIED = 10000;
export const TTD_USD_APPROX_RATE = 6.80;
export const SUPPORTED_BANKS = [
  'Republic Bank', 'First Citizens', 'Scotiabank', 'RBC Royal Bank', 'JMMB Bank'
] as const;
export const SUPPORTED_PAYMENT_METHODS = [
  ...SUPPORTED_BANKS, 'Linx', 'PayWise', 'Cash (in-person)'
] as const;
```

---

## Completion Checklist

When ALL agents have completed, the system should support:

- [ ] User opens Telegram bot → `/start` → gets welcome message with Mini App button
- [ ] User opens Mini App → sees order book of buy/sell offers
- [ ] User connects TON wallet via TON Connect button
- [ ] User creates a sell order: amount, price in TTD, payment method
- [ ] Buyer browses orders → accepts an offer → trade created
- [ ] Seller locks USDT in escrow via TON Connect
- [ ] Bot notifies buyer with seller's bank details
- [ ] Buyer marks "Payment Sent" → bot notifies seller
- [ ] Seller confirms → escrow releases USDT to buyer (minus fee)
- [ ] Dispute flow: either party disputes → admin resolves
- [ ] Optional KYC: user uploads ID + selfie via Sumsub → verified badge
- [ ] Verified users get higher trade limits
- [ ] Trade history and reputation scores visible in Mini App
- [ ] All on TON testnet for POC
