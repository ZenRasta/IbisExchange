-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'TTD';

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "feeAmount" DOUBLE PRECISION,
ADD COLUMN     "feePercent" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminLevel" TEXT,
ADD COLUMN     "banExpiresAt" TIMESTAMP(3),
ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "banType" TEXT,
ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "bannedBy" TEXT,
ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isBanned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferredCurrency" TEXT NOT NULL DEFAULT 'TTD',
ADD COLUMN     "totalDownvotes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalUpvotes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TradeReview" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "revieweeId" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "againstUser" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" JSONB,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeRecord" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "feeAmount" DOUBLE PRECISION NOT NULL,
    "feePercent" DOUBLE PRECISION NOT NULL,
    "paidBy" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeReview_revieweeId_idx" ON "TradeReview"("revieweeId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeReview_tradeId_reviewerId_key" ON "TradeReview"("tradeId", "reviewerId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_tradeId_idx" ON "Dispute"("tradeId");

-- CreateIndex
CREATE INDEX "FeeRecord_tradeId_idx" ON "FeeRecord"("tradeId");

-- CreateIndex
CREATE INDEX "Order_currency_status_idx" ON "Order"("currency", "status");

-- AddForeignKey
ALTER TABLE "TradeReview" ADD CONSTRAINT "TradeReview_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeReview" ADD CONSTRAINT "TradeReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeReview" ADD CONSTRAINT "TradeReview_revieweeId_fkey" FOREIGN KEY ("revieweeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_raisedBy_fkey" FOREIGN KEY ("raisedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_againstUser_fkey" FOREIGN KEY ("againstUser") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeRecord" ADD CONSTRAINT "FeeRecord_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
