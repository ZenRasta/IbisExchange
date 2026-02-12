# DATABASE_SCHEMA.md — Project Ibis Database Reference

This is the source of truth for the PostgreSQL schema. Agent 1 creates this via Prisma. All other agents reference it.

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderType {
  BUY
  SELL
}

enum OrderStatus {
  ACTIVE
  MATCHED
  PARTIALLY_MATCHED
  CANCELLED
  EXPIRED
}

enum TradeStatus {
  AWAITING_ESCROW
  ESCROW_LOCKED
  FIAT_SENT
  RELEASING
  COMPLETED
  REFUNDED
  DISPUTED
  RESOLVED_RELEASE
  RESOLVED_REFUND
  CANCELLED
  EXPIRED
}

enum KycStatus {
  NOT_STARTED
  PENDING
  ACTION_REQUIRED
  VERIFIED
  REJECTED
}

model User {
  id              String    @id @default(cuid())
  telegramId      Int       @unique
  firstName       String
  lastName        String?
  username        String?
  tonAddress      String?
  
  // KYC
  kycStatus       KycStatus @default(NOT_STARTED)
  kycApplicantId  String?   // Sumsub applicant ID
  kycVerifiedAt   DateTime?
  kycComment      String?
  
  // Limits
  maxTradeAmount  Float     @default(500) // USDT — 500 unverified, 10000 verified
  
  // Reputation
  reputationScore Float     @default(0)
  totalTrades     Int       @default(0)
  successfulTrades Int      @default(0)
  totalVolume     Float     @default(0) // Total USDT traded
  
  // Relations
  orders          Order[]
  buyTrades       Trade[]   @relation("BuyerTrades")
  sellTrades      Trade[]   @relation("SellerTrades")
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([telegramId])
  @@index([tonAddress])
}

model Order {
  id              String      @id @default(cuid())
  userId          String
  user            User        @relation(fields: [userId], references: [id])
  
  type            OrderType
  amount          Float       // Total USDT
  remainingAmount Float       // USDT still available
  pricePerUsdt    Float       // Price in TTD per 1 USDT
  paymentMethods  String[]    // Array of payment method strings
  bankDetails     String?     // Seller's bank details (encrypted at rest ideally)
  minTradeAmount  Float?      // Minimum per trade
  maxTradeAmount  Float?      // Maximum per trade
  
  status          OrderStatus @default(ACTIVE)
  
  trades          Trade[]
  
  expiresAt       DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([type, status])
  @@index([userId])
  @@index([pricePerUsdt])
}

model Trade {
  id              String      @id @default(cuid())
  orderId         String
  order           Order       @relation(fields: [orderId], references: [id])
  
  buyerId         String
  buyer           User        @relation("BuyerTrades", fields: [buyerId], references: [id])
  sellerId        String
  seller          User        @relation("SellerTrades", fields: [sellerId], references: [id])
  
  amount          Float       // USDT amount
  pricePerUsdt    Float       // TTD per USDT at time of trade
  fiatAmount      Float       // Total TTD (amount * pricePerUsdt)
  fiatCurrency    String      @default("TTD")
  paymentMethod   String      // Selected payment method for this trade
  
  // Escrow
  escrowId        Int?        // On-chain escrow ID from smart contract
  escrowTxHash    String?     // TON transaction hash for escrow lock
  releaseTxHash   String?     // TON transaction hash for release
  
  // Fiat settlement
  paymentReference String?    // e.g., "TRD-7829"
  bankDetails     String?     // Seller's bank details for this trade
  
  // Timestamps
  escrowLockedAt  DateTime?
  fiatSentAt      DateTime?
  completedAt     DateTime?
  disputedAt      DateTime?
  
  // Dispute
  disputeReason   String?
  disputeResolution String?
  
  status          TradeStatus @default(AWAITING_ESCROW)
  
  // Rating (after completion)
  buyerRating     Int?        // 1-5 stars
  sellerRating    Int?        // 1-5 stars
  
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([buyerId])
  @@index([sellerId])
  @@index([status])
  @@index([orderId])
}
```

## Key Relationships

- User 1:N Orders (a user can have multiple active orders)
- User 1:N Trades (as buyer OR seller)
- Order 1:N Trades (an order can be partially filled by multiple trades)
- Trade belongs to exactly 1 Order, 1 Buyer, 1 Seller

## Trade Status Flow

```
AWAITING_ESCROW → ESCROW_LOCKED → FIAT_SENT → RELEASING → COMPLETED
                                             → DISPUTED → RESOLVED_RELEASE
                                                        → RESOLVED_REFUND
AWAITING_ESCROW → CANCELLED (either party cancels before funding)
AWAITING_ESCROW → EXPIRED (30 min timeout, not funded)
ESCROW_LOCKED → REFUNDED (seller cancels before buyer pays)
```

## Constants (from packages/shared/src/constants.ts)

| Constant | Value | Used By |
|----------|-------|---------|
| MIN_TRADE_USDT | 10 | Order validation |
| MAX_TRADE_USDT_UNVERIFIED | 500 | Trade limit check |
| MAX_TRADE_USDT_VERIFIED | 10,000 | Trade limit check |
| PLATFORM_FEE_PERCENT | 1 | Escrow fee calculation |
| ESCROW_FUNDING_TIMEOUT | 1800 (30 min) | Auto-expire unfunded trades |
| ESCROW_TIMEOUT_SECONDS | 21600 (6 hrs) | Auto-release after fiat sent |
