import { prisma, MIN_TRADE_USDT, calculateFee } from '@ibis/shared';
import type { Trade } from '@prisma/client';
import { reputationService } from './reputationService';
import { notificationService } from './notificationService';

export class MatchingEngine {
    /**
     * Find the best sell orders matching the buyer's criteria.
     * Ordered by: best price (lowest), then reputation (highest), then oldest (FIFO).
     * Returns orders with included user info.
     */
    async findBestSellOrders(amount: number, paymentMethod?: string, limit = 20, currency?: string) {
        const where: Record<string, unknown> = {
            type: 'SELL',
            status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] },
            remainingAmount: { gte: Math.min(amount, MIN_TRADE_USDT) },
        };

        if (currency) {
            where.currency = currency;
        }

        if (paymentMethod) {
            where.paymentMethods = { has: paymentMethod };
        }

        const orders = await prisma.order.findMany({
            where,
            orderBy: [
                { pricePerUsdt: 'asc' },
                { createdAt: 'asc' },
            ],
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        username: true,
                        reputationScore: true,
                        totalTrades: true,
                        successfulTrades: true,
                        kycStatus: true,
                    },
                },
            },
            take: limit,
        });

        return orders;
    }

    /**
     * Find the best buy orders matching the seller's criteria.
     * Ordered by: best price (highest), then reputation (highest), then oldest (FIFO).
     */
    async findBestBuyOrders(amount: number, paymentMethod?: string, limit = 20, currency?: string) {
        const where: Record<string, unknown> = {
            type: 'BUY',
            status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] },
            remainingAmount: { gte: Math.min(amount, MIN_TRADE_USDT) },
        };

        if (currency) {
            where.currency = currency;
        }

        if (paymentMethod) {
            where.paymentMethods = { has: paymentMethod };
        }

        const orders = await prisma.order.findMany({
            where,
            orderBy: [
                { pricePerUsdt: 'desc' },
                { createdAt: 'asc' },
            ],
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        username: true,
                        reputationScore: true,
                        totalTrades: true,
                        successfulTrades: true,
                        kycStatus: true,
                    },
                },
            },
            take: limit,
        });

        return orders;
    }

    /**
     * Create a trade from accepting an order.
     * Handles both full and partial fills.
     */
    async createTrade(
        orderId: string,
        acceptorTgId: number,
        amount?: number
    ): Promise<Trade> {
        // Fetch order with user info
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { user: true },
        });

        if (!order) {
            throw new TradeError('Order not found', 'NOT_FOUND');
        }

        if (order.status !== 'ACTIVE' && order.status !== 'PARTIALLY_MATCHED') {
            throw new TradeError('Order is not active', 'ORDER_NOT_ACTIVE');
        }

        // Find acceptor user
        const acceptor = await prisma.user.findUnique({
            where: { telegramId: acceptorTgId },
        });

        if (!acceptor) {
            throw new TradeError('User not found', 'NOT_FOUND');
        }

        // Buyer cannot be seller
        if (order.userId === acceptor.id) {
            throw new TradeError('Cannot accept your own order', 'VALIDATION_ERROR');
        }

        // Determine trade amount
        const tradeAmount = amount || order.remainingAmount;

        // Validate amount is within range
        if (tradeAmount < (order.minTradeAmount || MIN_TRADE_USDT)) {
            throw new TradeError(
                `Minimum trade amount is ${order.minTradeAmount || MIN_TRADE_USDT} USDT`,
                'VALIDATION_ERROR'
            );
        }

        if (tradeAmount > order.remainingAmount) {
            throw new TradeError(
                `Only ${order.remainingAmount} USDT remaining on this order`,
                'VALIDATION_ERROR'
            );
        }

        if (order.maxTradeAmount && tradeAmount > order.maxTradeAmount) {
            throw new TradeError(
                `Maximum trade amount is ${order.maxTradeAmount} USDT`,
                'VALIDATION_ERROR'
            );
        }

        // Check trade limit for the acceptor
        const limitCheck = await reputationService.checkTradeLimit(acceptor.id, tradeAmount);
        if (!limitCheck.allowed) {
            throw new TradeError(limitCheck.reason || 'Trade limit exceeded', 'TRADE_LIMIT_EXCEEDED');
        }

        // Determine buyer and seller
        const buyerId = order.type === 'SELL' ? acceptor.id : order.userId;
        const sellerId = order.type === 'SELL' ? order.userId : acceptor.id;

        const fiatAmount = Math.round(tradeAmount * order.pricePerUsdt * 100) / 100;

        // Calculate fee
        const fee = calculateFee(tradeAmount);

        // Generate a unique escrowId for the on-chain escrow contract
        // Use lower 31 bits of timestamp + random to fit in a safe Int range
        const escrowId = ((Date.now() % 0x7FFFFFFF) ^ (Math.floor(Math.random() * 0x7FFFFFFF))) >>> 0;

        // Use a transaction to atomically create trade, update order, and record fee
        const trade = await prisma.$transaction(async (tx) => {
            // Update order remaining amount
            const newRemaining = order.remainingAmount - tradeAmount;
            const newStatus = newRemaining <= 0 ? 'MATCHED' : 'PARTIALLY_MATCHED';

            await tx.order.update({
                where: { id: orderId },
                data: {
                    remainingAmount: Math.max(0, newRemaining),
                    status: newStatus as 'MATCHED' | 'PARTIALLY_MATCHED',
                },
            });

            // Create the trade with fee info and order's currency
            const newTrade = await tx.trade.create({
                data: {
                    orderId,
                    buyerId,
                    sellerId,
                    amount: tradeAmount,
                    pricePerUsdt: order.pricePerUsdt,
                    fiatAmount,
                    fiatCurrency: order.currency || 'TTD',
                    paymentMethod: order.paymentMethods[0] || 'Unknown',
                    bankDetails: order.bankDetails,
                    status: 'AWAITING_ESCROW',
                    escrowId,
                    feeAmount: fee.feeAmount,
                    feePercent: fee.feePercent,
                },
            });

            // Create a FeeRecord
            await tx.feeRecord.create({
                data: {
                    tradeId: newTrade.id,
                    feeAmount: fee.feeAmount,
                    feePercent: fee.feePercent,
                    paidBy: sellerId,
                },
            });

            return newTrade;
        });

        // Publish notification (non-blocking)
        const buyer = await prisma.user.findUnique({ where: { id: buyerId } });
        const seller = await prisma.user.findUnique({ where: { id: sellerId } });

        notificationService.publishTradeEvent({
            type: 'TRADE_CREATED',
            tradeId: trade.id,
            buyerTelegramId: buyer?.telegramId ?? 0,
            sellerTelegramId: seller?.telegramId ?? 0,
            amount: tradeAmount,
            fiatAmount,
            paymentMethod: trade.paymentMethod,
            bankDetails: trade.bankDetails || undefined,
        });

        return trade;
    }

    /**
     * Expire stale orders (older than 24h with no activity, or past expiresAt).
     * Returns the number of orders expired.
     */
    async expireStaleOrders(): Promise<number> {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const result = await prisma.order.updateMany({
            where: {
                status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] },
                OR: [
                    { expiresAt: { lte: new Date() } },
                    {
                        updatedAt: { lte: oneDayAgo },
                        expiresAt: null,
                    },
                ],
            },
            data: { status: 'EXPIRED' },
        });

        if (result.count > 0) {
            console.log(`Expired ${result.count} stale orders`);
        }

        return result.count;
    }

    /**
     * Handle escrow funding timeout — cancel the trade and restore order amount.
     */
    async handleEscrowTimeout(tradeId: string): Promise<void> {
        const trade = await prisma.trade.findUnique({
            where: { id: tradeId },
            include: { buyer: true, seller: true },
        });

        if (!trade || trade.status !== 'AWAITING_ESCROW') return;

        await prisma.$transaction(async (tx) => {
            // Cancel the trade
            await tx.trade.update({
                where: { id: tradeId },
                data: { status: 'EXPIRED' },
            });

            // Restore the order's remaining amount
            await tx.order.update({
                where: { id: trade.orderId },
                data: {
                    remainingAmount: { increment: trade.amount },
                    status: 'ACTIVE',
                },
            });
        });

        notificationService.publishTradeEvent({
            type: 'ESCROW_TIMEOUT',
            tradeId,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
        });
    }

    /**
     * Handle fiat payment timeout — auto-dispute.
     */
    async handleFiatTimeout(tradeId: string): Promise<void> {
        const trade = await prisma.trade.findUnique({
            where: { id: tradeId },
            include: { buyer: true, seller: true },
        });

        if (!trade || trade.status !== 'FIAT_SENT') return;

        await prisma.trade.update({
            where: { id: tradeId },
            data: {
                status: 'DISPUTED',
                disputedAt: new Date(),
                disputeReason: 'Fiat payment confirmation timed out after 6 hours',
            },
        });

        notificationService.publishTradeEvent({
            type: 'FIAT_TIMEOUT',
            tradeId,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
        });

        notificationService.notifyAdmins(
            `Trade ${tradeId} auto-disputed: fiat payment confirmation timed out`,
            { tradeId, amount: trade.amount }
        );
    }
}

export class TradeError extends Error {
    code: string;
    constructor(message: string, code: string) {
        super(message);
        this.code = code;
        this.name = 'TradeError';
    }
}

export const matchingEngine = new MatchingEngine();
