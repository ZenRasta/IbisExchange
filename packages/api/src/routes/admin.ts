import { Router, Request, Response, NextFunction } from 'express';
import { prisma, calculateFee } from '@ibis/shared';
import { notificationService } from '../services/notificationService';
import { reputationService } from '../services/reputationService';

export const adminRouter = Router();

/**
 * Admin middleware: check if user's telegramId is in ADMIN_TELEGRAM_IDS
 * or user.isAdmin is true.
 */
async function adminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tgId = req.telegramUser!.id;

    // Check env-based admin list
    const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map(Number);

    if (adminIds.includes(tgId)) {
        next();
        return;
    }

    // Check database admin flag
    const user = await prisma.user.findUnique({
        where: { telegramId: tgId },
        select: { isAdmin: true },
    });

    if (user?.isAdmin) {
        next();
        return;
    }

    res.status(403).json({ success: false, error: 'Admin access required', code: 'UNAUTHORIZED' });
}

// Apply admin middleware to all routes
adminRouter.use(adminAuth);

// ===================== DISPUTES =====================

/**
 * GET /api/admin/disputes - List all disputes (filterable by status)
 */
adminRouter.get('/disputes', async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;
        const status = req.query.status as string | undefined;

        const where: Record<string, unknown> = {};
        if (status) {
            where.status = status;
        }

        const [disputes, total] = await Promise.all([
            prisma.dispute.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    trade: {
                        select: {
                            id: true,
                            amount: true,
                            fiatAmount: true,
                            fiatCurrency: true,
                            status: true,
                        },
                    },
                    raiser: {
                        select: { id: true, firstName: true, username: true, telegramId: true },
                    },
                    target: {
                        select: { id: true, firstName: true, username: true, telegramId: true },
                    },
                },
                skip,
                take: limit,
            }),
            prisma.dispute.count({ where }),
        ]);

        res.json({
            success: true,
            data: disputes,
            pagination: { page, limit, total },
        });
    } catch (err) {
        console.error('GET /admin/disputes error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/admin/disputes/:id - Full dispute detail with trade and user info
 */
adminRouter.get('/disputes/:id', async (req: Request, res: Response) => {
    try {
        const dispute = await prisma.dispute.findUnique({
            where: { id: req.params.id as string },
            include: {
                trade: {
                    include: {
                        buyer: {
                            select: {
                                id: true,
                                telegramId: true,
                                firstName: true,
                                username: true,
                                reputationScore: true,
                                totalTrades: true,
                                totalUpvotes: true,
                                totalDownvotes: true,
                                kycStatus: true,
                                isBanned: true,
                            },
                        },
                        seller: {
                            select: {
                                id: true,
                                telegramId: true,
                                firstName: true,
                                username: true,
                                reputationScore: true,
                                totalTrades: true,
                                totalUpvotes: true,
                                totalDownvotes: true,
                                kycStatus: true,
                                isBanned: true,
                            },
                        },
                        order: {
                            select: { id: true, type: true, paymentMethods: true },
                        },
                    },
                },
                raiser: {
                    select: { id: true, firstName: true, username: true, telegramId: true },
                },
                target: {
                    select: { id: true, firstName: true, username: true, telegramId: true },
                },
            },
        });

        if (!dispute) {
            res.status(404).json({ success: false, error: 'Dispute not found', code: 'NOT_FOUND' });
            return;
        }

        res.json({ success: true, data: dispute });
    } catch (err) {
        console.error('GET /admin/disputes/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * PUT /api/admin/disputes/:id/status - Update dispute status (under_review)
 */
adminRouter.put('/disputes/:id/status', async (req: Request, res: Response) => {
    try {
        const { status } = req.body || {};

        if (!status || status !== 'under_review') {
            res.status(400).json({
                success: false,
                error: 'status must be "under_review"',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const dispute = await prisma.dispute.findUnique({
            where: { id: req.params.id as string },
        });

        if (!dispute) {
            res.status(404).json({ success: false, error: 'Dispute not found', code: 'NOT_FOUND' });
            return;
        }

        if (dispute.status !== 'open') {
            res.status(400).json({
                success: false,
                error: `Cannot change status from ${dispute.status} to under_review`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const updated = await prisma.dispute.update({
            where: { id: req.params.id as string },
            data: { status: 'under_review' },
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('PUT /admin/disputes/:id/status error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/admin/disputes/:id/resolve - Resolve a dispute
 */
adminRouter.post('/disputes/:id/resolve', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const adminUser = await prisma.user.findUnique({ where: { telegramId: tgId } });

        const {
            outcome,
            action,
            banUserId,
            banType,
            banReason,
            notes,
        } = req.body || {};

        // Validate outcome
        const validOutcomes = ['buyer_wins', 'seller_wins', 'mutual', 'dismissed'];
        if (!outcome || !validOutcomes.includes(outcome)) {
            res.status(400).json({
                success: false,
                error: `outcome must be one of: ${validOutcomes.join(', ')}`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate action
        const validActions = ['release_to_buyer', 'return_to_seller', 'split', 'no_action'];
        if (!action || !validActions.includes(action)) {
            res.status(400).json({
                success: false,
                error: `action must be one of: ${validActions.join(', ')}`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const dispute = await prisma.dispute.findUnique({
            where: { id: req.params.id as string },
            include: {
                trade: {
                    include: { buyer: true, seller: true },
                },
            },
        });

        if (!dispute) {
            res.status(404).json({ success: false, error: 'Dispute not found', code: 'NOT_FOUND' });
            return;
        }

        if (dispute.status === 'resolved' || dispute.status === 'dismissed') {
            res.status(400).json({
                success: false,
                error: 'Dispute is already resolved',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Determine new trade status based on action
        let newTradeStatus: string;
        switch (action) {
            case 'release_to_buyer':
                newTradeStatus = 'RESOLVED_RELEASE';
                break;
            case 'return_to_seller':
                newTradeStatus = 'RESOLVED_REFUND';
                break;
            case 'split':
                newTradeStatus = 'RESOLVED_RELEASE'; // Default to release for splits
                break;
            case 'no_action':
            default:
                newTradeStatus = dispute.trade.status; // Keep current status
                break;
        }

        const resolution = {
            outcome,
            action,
            resolvedBy: adminUser?.id || String(tgId),
            resolvedAt: new Date().toISOString(),
            notes: notes || null,
        };

        // Resolve dispute, update trade, optionally ban user, optionally create fee record
        await prisma.$transaction(async (tx) => {
            // Update dispute
            await tx.dispute.update({
                where: { id: req.params.id as string },
                data: {
                    status: outcome === 'dismissed' ? 'dismissed' : 'resolved',
                    resolution,
                    resolvedBy: adminUser?.id || String(tgId),
                    resolvedAt: new Date(),
                    adminNotes: notes || null,
                },
            });

            // Update trade status
            if (action !== 'no_action') {
                await tx.trade.update({
                    where: { id: dispute.tradeId },
                    data: {
                        status: newTradeStatus as any,
                        disputeResolution: outcome,
                        completedAt: new Date(),
                    },
                });
            }

            // Optionally ban a user
            if (banUserId && banReason) {
                await tx.user.update({
                    where: { id: banUserId },
                    data: {
                        isBanned: true,
                        bannedAt: new Date(),
                        bannedBy: adminUser?.id || String(tgId),
                        banReason,
                        banType: banType || 'permanent',
                    },
                });

                // Cancel all active orders for banned user
                await tx.order.updateMany({
                    where: {
                        userId: banUserId,
                        status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] },
                    },
                    data: { status: 'CANCELLED' },
                });
            }

            // Create fee record if applicable (release or split)
            if (action === 'release_to_buyer' || action === 'split') {
                const fee = calculateFee(dispute.trade.amount);
                await tx.feeRecord.create({
                    data: {
                        tradeId: dispute.tradeId,
                        feeAmount: fee.feeAmount,
                        feePercent: fee.feePercent,
                        paidBy: dispute.trade.sellerId,
                    },
                });
            }
        });

        // Update reputation based on outcome
        if (action === 'release_to_buyer') {
            await reputationService.recordDispute(dispute.trade, 'seller');
        } else if (action === 'return_to_seller') {
            await reputationService.recordDispute(dispute.trade, 'buyer');
        }

        // Notify both parties
        notificationService.publishTradeEvent({
            type: 'TRADE_RESOLVED',
            tradeId: dispute.tradeId,
            buyerTelegramId: dispute.trade.buyer.telegramId,
            sellerTelegramId: dispute.trade.seller.telegramId,
            amount: dispute.trade.amount,
            fiatAmount: dispute.trade.fiatAmount,
            extra: { outcome, action, disputeId: dispute.id },
        });

        // Refetch the updated dispute
        const updatedDispute = await prisma.dispute.findUnique({
            where: { id: req.params.id as string },
            include: {
                trade: {
                    select: { id: true, status: true, amount: true, fiatAmount: true },
                },
            },
        });

        res.json({ success: true, data: updatedDispute });
    } catch (err) {
        console.error('POST /admin/disputes/:id/resolve error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

// ===================== USERS =====================

/**
 * POST /api/admin/users/:id/ban - Ban a user
 */
adminRouter.post('/users/:id/ban', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const adminUser = await prisma.user.findUnique({ where: { telegramId: tgId } });

        const { reason, type, expiresAt } = req.body || {};

        if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
            res.status(400).json({
                success: false,
                error: 'Ban reason is required',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const banType = type || 'permanent';
        if (banType !== 'permanent' && banType !== 'temporary') {
            res.status(400).json({
                success: false,
                error: 'type must be "permanent" or "temporary"',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        if (banType === 'temporary' && !expiresAt) {
            res.status(400).json({
                success: false,
                error: 'expiresAt is required for temporary bans',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const targetUser = await prisma.user.findUnique({ where: { id: req.params.id as string } });
        if (!targetUser) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        // Ban user and cancel all active orders in a transaction
        const updated = await prisma.$transaction(async (tx) => {
            const banned = await tx.user.update({
                where: { id: req.params.id as string },
                data: {
                    isBanned: true,
                    bannedAt: new Date(),
                    bannedBy: adminUser?.id || String(tgId),
                    banReason: reason.trim(),
                    banType,
                    banExpiresAt: expiresAt ? new Date(expiresAt) : null,
                },
            });

            // Cancel all active orders
            await tx.order.updateMany({
                where: {
                    userId: req.params.id as string,
                    status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] },
                },
                data: { status: 'CANCELLED' },
            });

            return banned;
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('POST /admin/users/:id/ban error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * DELETE /api/admin/users/:id/ban - Unban a user
 */
adminRouter.delete('/users/:id/ban', async (req: Request, res: Response) => {
    try {
        const targetUser = await prisma.user.findUnique({ where: { id: req.params.id as string } });
        if (!targetUser) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        if (!targetUser.isBanned) {
            res.status(400).json({
                success: false,
                error: 'User is not banned',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const updated = await prisma.user.update({
            where: { id: req.params.id as string },
            data: {
                isBanned: false,
                bannedAt: null,
                bannedBy: null,
                banReason: null,
                banType: null,
                banExpiresAt: null,
            },
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('DELETE /admin/users/:id/ban error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/admin/users - List all users (with search, pagination)
 */
adminRouter.get('/users', async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;
        const search = (req.query.search as string) || '';
        const banned = req.query.banned as string | undefined;

        const where: Record<string, unknown> = {};

        if (search.trim()) {
            where.OR = [
                { username: { contains: search.trim(), mode: 'insensitive' } },
                { firstName: { contains: search.trim(), mode: 'insensitive' } },
            ];
        }

        if (banned === 'true') {
            where.isBanned = true;
        } else if (banned === 'false') {
            where.isBanned = false;
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.user.count({ where }),
        ]);

        res.json({
            success: true,
            data: users,
            pagination: { page, limit, total },
        });
    } catch (err) {
        console.error('GET /admin/users error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/admin/users/:id - Full user detail
 */
adminRouter.get('/users/:id', async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.params.id as string },
            include: {
                _count: {
                    select: {
                        orders: true,
                        buyTrades: true,
                        sellTrades: true,
                        reviewsGiven: true,
                        reviewsReceived: true,
                        disputesRaised: true,
                        disputesAgainst: true,
                    },
                },
            },
        });

        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        res.json({ success: true, data: user });
    } catch (err) {
        console.error('GET /admin/users/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

// ===================== ORDERS =====================

/**
 * GET /api/admin/orders - All orders (all statuses)
 */
adminRouter.get('/orders', async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;
        const status = req.query.status as string | undefined;
        const type = req.query.type as string | undefined;

        const where: Record<string, unknown> = {};

        if (status) {
            where.status = status;
        }
        if (type && (type === 'BUY' || type === 'SELL')) {
            where.type = type;
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            username: true,
                            telegramId: true,
                            kycStatus: true,
                            isBanned: true,
                        },
                    },
                },
                skip,
                take: limit,
            }),
            prisma.order.count({ where }),
        ]);

        res.json({
            success: true,
            data: orders,
            pagination: { page, limit, total },
        });
    } catch (err) {
        console.error('GET /admin/orders error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * PUT /api/admin/orders/:id/cancel - Force-cancel an order
 */
adminRouter.put('/orders/:id/cancel', async (req: Request, res: Response) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id as string } });

        if (!order) {
            res.status(404).json({ success: false, error: 'Order not found', code: 'NOT_FOUND' });
            return;
        }

        if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
            res.status(400).json({
                success: false,
                error: 'Order is already cancelled or expired',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const updated = await prisma.order.update({
            where: { id: req.params.id as string },
            data: { status: 'CANCELLED' },
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('PUT /admin/orders/:id/cancel error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

// ===================== STATS =====================

/**
 * GET /api/admin/stats - Dashboard stats
 */
adminRouter.get('/stats', async (_req: Request, res: Response) => {
    try {
        const [
            totalTrades,
            completedTrades,
            activeTrades,
            totalUsers,
            activeUsers,
            bannedUsers,
            openDisputes,
            totalOrders,
            activeOrders,
        ] = await Promise.all([
            prisma.trade.count(),
            prisma.trade.count({ where: { status: { in: ['COMPLETED', 'RESOLVED_RELEASE', 'RESOLVED_REFUND'] } } }),
            prisma.trade.count({ where: { status: { in: ['AWAITING_ESCROW', 'ESCROW_LOCKED', 'FIAT_SENT', 'RELEASING'] } } }),
            prisma.user.count(),
            prisma.user.count({ where: { totalTrades: { gt: 0 } } }),
            prisma.user.count({ where: { isBanned: true } }),
            prisma.dispute.count({ where: { status: { in: ['open', 'under_review'] } } }),
            prisma.order.count(),
            prisma.order.count({ where: { status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] } } }),
        ]);

        // Volume by currency (from completed trades)
        const completedTradesList = await prisma.trade.findMany({
            where: { status: { in: ['COMPLETED', 'RESOLVED_RELEASE', 'RESOLVED_REFUND'] } },
            select: { amount: true, fiatAmount: true, fiatCurrency: true },
        });

        const volumeByCurrency: Record<string, { usdtVolume: number; fiatVolume: number; tradeCount: number }> = {};
        let totalUsdtVolume = 0;

        for (const trade of completedTradesList) {
            const currency = trade.fiatCurrency;
            if (!volumeByCurrency[currency]) {
                volumeByCurrency[currency] = { usdtVolume: 0, fiatVolume: 0, tradeCount: 0 };
            }
            volumeByCurrency[currency].usdtVolume += trade.amount;
            volumeByCurrency[currency].fiatVolume += trade.fiatAmount;
            volumeByCurrency[currency].tradeCount += 1;
            totalUsdtVolume += trade.amount;
        }

        // Fees collected
        const feeRecords = await prisma.feeRecord.aggregate({
            _sum: { feeAmount: true },
        });
        const feesCollected = feeRecords._sum.feeAmount || 0;

        res.json({
            success: true,
            data: {
                totalTrades,
                completedTrades,
                activeTrades,
                totalUsers,
                activeUsers,
                bannedUsers,
                openDisputes,
                totalOrders,
                activeOrders,
                totalUsdtVolume: Math.round(totalUsdtVolume * 100) / 100,
                volumeByCurrency,
                feesCollected: Math.round(feesCollected * 100) / 100,
            },
        });
    } catch (err) {
        console.error('GET /admin/stats error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});
