import { Router, Request, Response } from 'express';
import { prisma, ESCROW_TIMEOUT_SECONDS } from '@ibis/shared';
import { redis, connectRedis } from '@ibis/shared';
import { matchingEngine, TradeError } from '../services/matchingEngine';
import { reputationService } from '../services/reputationService';
import { notificationService } from '../services/notificationService';

export const tradesRouter = Router();

/**
 * Helper to get admin Telegram IDs from env.
 */
function getAdminIds(): number[] {
    return (process.env.ADMIN_TELEGRAM_IDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map(Number);
}

/**
 * POST /api/trades — Accept an order and create a trade
 */
tradesRouter.post('/', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const { orderId, amount } = req.body;

        if (!orderId) {
            res.status(400).json({
                success: false,
                error: 'orderId is required',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const trade = await matchingEngine.createTrade(orderId, tgId, amount || undefined);

        // Set escrow funding timeout in Redis (30 minutes)
        try {
            await connectRedis();
            await redis.set(
                `trade:timeout:${trade.id}`,
                Date.now().toString(),
                { EX: 1800 }
            );
        } catch (err) {
            console.error('Failed to set escrow timeout:', err);
        }

        const fullTrade = await prisma.trade.findUnique({
            where: { id: trade.id },
            include: {
                buyer: {
                    select: { id: true, firstName: true, username: true, telegramId: true },
                },
                seller: {
                    select: { id: true, firstName: true, username: true, telegramId: true },
                },
                order: {
                    select: { id: true, type: true, paymentMethods: true, bankDetails: true },
                },
            },
        });

        res.status(201).json({ success: true, data: fullTrade });
    } catch (err) {
        if (err instanceof TradeError) {
            const statusCode = err.code === 'NOT_FOUND' ? 404 : 400;
            res.status(statusCode).json({ success: false, error: err.message, code: err.code });
            return;
        }
        console.error('POST /trades error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/trades — List user's trades
 */
tradesRouter.get('/', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;
        const status = req.query.status as string | undefined;

        const where: Record<string, unknown> = {
            OR: [{ buyerId: user.id }, { sellerId: user.id }],
        };

        if (status) {
            const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
            where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
        }

        const [trades, total] = await Promise.all([
            prisma.trade.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    buyer: {
                        select: { id: true, firstName: true, username: true, reputationScore: true },
                    },
                    seller: {
                        select: { id: true, firstName: true, username: true, reputationScore: true },
                    },
                    order: {
                        select: { id: true, type: true, paymentMethods: true },
                    },
                },
                skip,
                take: limit,
            }),
            prisma.trade.count({ where }),
        ]);

        res.json({
            success: true,
            data: trades,
            pagination: { page, limit, total },
        });
    } catch (err) {
        console.error('GET /trades error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/trades/:id — Single trade detail
 */
tradesRouter.get('/:id', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });

        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id as string },
            include: {
                buyer: {
                    select: { id: true, firstName: true, username: true, telegramId: true, reputationScore: true },
                },
                seller: {
                    select: { id: true, firstName: true, username: true, telegramId: true, reputationScore: true },
                },
                order: {
                    select: { id: true, type: true, paymentMethods: true, bankDetails: true },
                },
            },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        // Only participants can view trade details
        if (user && trade.buyerId !== user.id && trade.sellerId !== user.id) {
            const adminIds = getAdminIds();
            if (!adminIds.includes(tgId)) {
                res.status(403).json({ success: false, error: 'Access denied', code: 'UNAUTHORIZED' });
                return;
            }
        }

        res.json({ success: true, data: trade });
    } catch (err) {
        console.error('GET /trades/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/trades/:id/escrow-locked — Backend confirms escrow was funded
 * Called after TON monitor detects USDT deposit to escrow.
 */
tradesRouter.post('/:id/escrow-locked', async (req: Request, res: Response) => {
    try {
        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id as string },
            include: { buyer: true, seller: true },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        if (trade.status !== 'AWAITING_ESCROW') {
            res.status(400).json({
                success: false,
                error: `Trade is in ${trade.status} state, expected AWAITING_ESCROW`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const { txHash } = req.body || {};

        const updated = await prisma.trade.update({
            where: { id: req.params.id as string },
            data: {
                status: 'ESCROW_LOCKED',
                escrowTxHash: txHash || null,
                escrowLockedAt: new Date(),
            },
        });

        // Clear escrow funding timeout
        try {
            await connectRedis();
            await redis.del(`trade:timeout:${trade.id}`);
            // Set fiat payment timeout (6 hours)
            await redis.set(`trade:fiat_timeout:${trade.id}`, Date.now().toString(), { EX: ESCROW_TIMEOUT_SECONDS });
        } catch {
            // Non-critical
        }

        notificationService.publishTradeEvent({
            type: 'ESCROW_LOCKED',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
            paymentMethod: trade.paymentMethod,
            bankDetails: trade.bankDetails || undefined,
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('POST /trades/:id/escrow-locked error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/trades/:id/fiat-sent — Buyer confirms fiat payment
 */
tradesRouter.post('/:id/fiat-sent', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id as string },
            include: { buyer: true, seller: true },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        // Only the buyer can confirm fiat sent
        if (trade.buyerId !== user.id) {
            res.status(403).json({
                success: false,
                error: 'Only the buyer can confirm fiat payment',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        if (trade.status !== 'ESCROW_LOCKED') {
            res.status(400).json({
                success: false,
                error: `Trade is in ${trade.status} state, expected ESCROW_LOCKED`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const { paymentReference } = req.body || {};

        const updated = await prisma.trade.update({
            where: { id: req.params.id as string },
            data: {
                status: 'FIAT_SENT',
                paymentReference: paymentReference || null,
                fiatSentAt: new Date(),
            },
        });

        // Set 6-hour fiat confirmation timeout
        try {
            await connectRedis();
            await redis.set(`trade:fiat_timeout:${trade.id}`, Date.now().toString(), { EX: ESCROW_TIMEOUT_SECONDS });
        } catch {
            // Non-critical
        }

        notificationService.publishTradeEvent({
            type: 'FIAT_SENT',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
            paymentMethod: trade.paymentMethod,
            extra: { paymentReference: paymentReference || undefined },
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('POST /trades/:id/fiat-sent error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/trades/:id/confirm-receipt — Seller confirms fiat received
 */
tradesRouter.post('/:id/confirm-receipt', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id as string },
            include: { buyer: true, seller: true },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        // Only the seller can confirm receipt
        if (trade.sellerId !== user.id) {
            res.status(403).json({
                success: false,
                error: 'Only the seller can confirm fiat receipt',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        if (trade.status !== 'FIAT_SENT') {
            res.status(400).json({
                success: false,
                error: `Trade is in ${trade.status} state, expected FIAT_SENT`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Set status to RELEASING — escrow release will be triggered
        const updated = await prisma.trade.update({
            where: { id: req.params.id as string },
            data: { status: 'RELEASING' },
        });

        // Clear fiat timeout
        try {
            await connectRedis();
            await redis.del(`trade:fiat_timeout:${trade.id}`);
        } catch {
            // Non-critical
        }

        notificationService.publishTradeEvent({
            type: 'FIAT_CONFIRMED',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
        });

        // In a real implementation, the escrow release would be triggered here
        // and the TON monitor would detect the release tx and mark COMPLETED.
        // For POC, we immediately mark as COMPLETED.
        const completed = await prisma.trade.update({
            where: { id: req.params.id as string },
            data: {
                status: 'COMPLETED',
                completedAt: new Date(),
            },
        });

        // Create a FeeRecord if the trade has a fee
        if (completed.feeAmount && completed.feeAmount > 0) {
            try {
                await prisma.feeRecord.create({
                    data: {
                        tradeId: completed.id,
                        feeAmount: completed.feeAmount,
                        feePercent: completed.feePercent || 0,
                        paidBy: completed.sellerId,
                    },
                });
            } catch (feeErr) {
                console.error('Failed to create FeeRecord on completion:', feeErr);
            }
        }

        // Update reputation for both parties
        await reputationService.recordCompletedTrade(completed);

        notificationService.publishTradeEvent({
            type: 'TRADE_COMPLETED',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
        });

        res.json({ success: true, data: completed });
    } catch (err) {
        console.error('POST /trades/:id/confirm-receipt error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/trades/:id/dispute — Open a dispute
 */
tradesRouter.post('/:id/dispute', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id as string },
            include: { buyer: true, seller: true },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        // Only participants can dispute
        if (trade.buyerId !== user.id && trade.sellerId !== user.id) {
            res.status(403).json({
                success: false,
                error: 'Only trade participants can open a dispute',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        // Can only dispute after escrow is locked
        const disputableStatuses = ['ESCROW_LOCKED', 'FIAT_SENT', 'RELEASING'];
        if (!disputableStatuses.includes(trade.status)) {
            res.status(400).json({
                success: false,
                error: `Cannot dispute a trade in ${trade.status} state`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const { reason } = req.body || {};
        if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
            res.status(400).json({
                success: false,
                error: 'A dispute reason is required',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const updated = await prisma.trade.update({
            where: { id: req.params.id as string },
            data: {
                status: 'DISPUTED',
                disputedAt: new Date(),
                disputeReason: reason.trim(),
            },
        });

        notificationService.publishTradeEvent({
            type: 'TRADE_DISPUTED',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
            extra: { reason: reason.trim(), disputedBy: tgId },
        });

        notificationService.notifyAdmins(
            `Dispute opened on trade ${trade.id} by user ${tgId}: ${reason.trim()}`
        );

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('POST /trades/:id/dispute error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/trades/:id/resolve — Admin resolves a dispute
 */
tradesRouter.post('/:id/resolve', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;

        // Only admins can resolve disputes
        const adminIds = getAdminIds();
        if (!adminIds.includes(tgId)) {
            res.status(403).json({
                success: false,
                error: 'Only administrators can resolve disputes',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id as string },
            include: { buyer: true, seller: true },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        if (trade.status !== 'DISPUTED') {
            res.status(400).json({
                success: false,
                error: `Trade is in ${trade.status} state, expected DISPUTED`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const { resolution } = req.body || {};
        if (!resolution || (resolution !== 'RELEASE' && resolution !== 'REFUND')) {
            res.status(400).json({
                success: false,
                error: 'resolution must be RELEASE or REFUND',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const newStatus = resolution === 'RELEASE' ? 'RESOLVED_RELEASE' : 'RESOLVED_REFUND';
        const loser = resolution === 'RELEASE' ? 'seller' : 'buyer';

        const updated = await prisma.trade.update({
            where: { id: req.params.id as string },
            data: {
                status: newStatus as 'RESOLVED_RELEASE' | 'RESOLVED_REFUND',
                disputeResolution: resolution,
                completedAt: new Date(),
            },
        });

        // Update reputation — penalize the loser
        await reputationService.recordDispute(updated, loser);

        notificationService.publishTradeEvent({
            type: 'TRADE_RESOLVED',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
            extra: { resolution },
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('POST /trades/:id/resolve error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/trades/:id/rate — Rate counterparty after trade completion
 */
tradesRouter.post('/:id/rate', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id as string },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        // Only completed/resolved trades can be rated
        const rateableStatuses = ['COMPLETED', 'RESOLVED_RELEASE', 'RESOLVED_REFUND'];
        if (!rateableStatuses.includes(trade.status)) {
            res.status(400).json({
                success: false,
                error: 'Can only rate completed trades',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const { rating } = req.body || {};
        if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
            res.status(400).json({
                success: false,
                error: 'Rating must be a number between 1 and 5',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const isBuyer = trade.buyerId === user.id;
        const isSeller = trade.sellerId === user.id;

        if (!isBuyer && !isSeller) {
            res.status(403).json({
                success: false,
                error: 'Only trade participants can rate',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        // Check if already rated
        if (isBuyer && trade.buyerRating !== null) {
            res.status(400).json({
                success: false,
                error: 'You have already rated this trade',
                code: 'VALIDATION_ERROR',
            });
            return;
        }
        if (isSeller && trade.sellerRating !== null) {
            res.status(400).json({
                success: false,
                error: 'You have already rated this trade',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const updated = await prisma.trade.update({
            where: { id: req.params.id as string },
            data: isBuyer ? { buyerRating: rating } : { sellerRating: rating },
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('POST /trades/:id/rate error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/trades/:id/cancel — Cancel trade before escrow is locked
 */
tradesRouter.post('/:id/cancel', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id as string },
            include: { buyer: true, seller: true },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        // Only participants can cancel
        if (trade.buyerId !== user.id && trade.sellerId !== user.id) {
            res.status(403).json({
                success: false,
                error: 'Only trade participants can cancel',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        // Can only cancel before escrow is locked
        if (trade.status !== 'AWAITING_ESCROW') {
            res.status(400).json({
                success: false,
                error: `Cannot cancel a trade in ${trade.status} state. Only AWAITING_ESCROW trades can be cancelled.`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Cancel trade and restore order amount
        const updated = await prisma.$transaction(async (tx) => {
            const cancelled = await tx.trade.update({
                where: { id: req.params.id as string },
                data: { status: 'CANCELLED' },
            });

            // Restore order remaining amount
            await tx.order.update({
                where: { id: trade.orderId },
                data: {
                    remainingAmount: { increment: trade.amount },
                    status: 'ACTIVE',
                },
            });

            return cancelled;
        });

        // Clear escrow timeout
        try {
            await connectRedis();
            await redis.del(`trade:timeout:${trade.id}`);
        } catch {
            // Non-critical
        }

        notificationService.publishTradeEvent({
            type: 'TRADE_CANCELLED',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('POST /trades/:id/cancel error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});
