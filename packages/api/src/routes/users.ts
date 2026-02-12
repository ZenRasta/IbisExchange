import { Router, Request, Response } from 'express';
import { prisma } from '@ibis/shared';
import { reputationService } from '../services/reputationService';

export const usersRouter = Router();

/**
 * GET /api/users/me — Current user profile
 */
usersRouter.get('/me', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;

        let user = await prisma.user.findUnique({
            where: { telegramId: tgId },
            include: {
                _count: {
                    select: {
                        orders: true,
                        buyTrades: true,
                        sellTrades: true,
                    },
                },
            },
        });

        // Auto-create user if first API call
        if (!user) {
            user = await prisma.user.create({
                data: {
                    telegramId: tgId,
                    firstName: req.telegramUser!.first_name,
                    lastName: req.telegramUser!.last_name || null,
                    username: req.telegramUser!.username || null,
                },
                include: {
                    _count: {
                        select: {
                            orders: true,
                            buyTrades: true,
                            sellTrades: true,
                        },
                    },
                },
            });
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                telegramId: user.telegramId,
                firstName: user.firstName,
                lastName: user.lastName,
                username: user.username,
                tonAddress: user.tonAddress,
                kycStatus: user.kycStatus,
                kycVerifiedAt: user.kycVerifiedAt,
                maxTradeAmount: user.maxTradeAmount,
                reputationScore: user.reputationScore,
                totalTrades: user.totalTrades,
                successfulTrades: user.successfulTrades,
                totalVolume: user.totalVolume,
                successRate:
                    user.totalTrades > 0
                        ? Math.round((user.successfulTrades / user.totalTrades) * 100)
                        : 0,
                counts: user._count,
                createdAt: user.createdAt,
            },
        });
    } catch (err) {
        console.error('GET /users/me error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/users/me/stats — Current user stats for dashboard
 */
usersRouter.get('/me/stats', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.json({
                success: true,
                data: { activeOrders: 0, pendingTrades: 0, completedTrades: 0, totalVolume: 0, reputationScore: 0 },
            });
            return;
        }

        const [activeOrders, pendingTrades, completedTrades] = await Promise.all([
            prisma.order.count({
                where: { userId: user.id, status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] } },
            }),
            prisma.trade.count({
                where: {
                    OR: [{ buyerId: user.id }, { sellerId: user.id }],
                    status: { in: ['AWAITING_ESCROW', 'ESCROW_LOCKED', 'FIAT_SENT', 'RELEASING'] },
                },
            }),
            prisma.trade.count({
                where: {
                    OR: [{ buyerId: user.id }, { sellerId: user.id }],
                    status: 'COMPLETED',
                },
            }),
        ]);

        res.json({
            success: true,
            data: {
                activeOrders,
                pendingTrades,
                completedTrades,
                totalVolume: user.totalVolume,
                reputationScore: user.reputationScore,
            },
        });
    } catch (err) {
        console.error('GET /users/me/stats error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * PUT /api/users/me — Update profile (displayName, tonAddress)
 */
usersRouter.put('/me', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;

        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const updateData: Record<string, unknown> = {};
        const { displayName, tonAddress } = req.body || {};

        if (displayName !== undefined) {
            if (typeof displayName !== 'string' || displayName.trim().length === 0) {
                res.status(400).json({
                    success: false,
                    error: 'displayName must be a non-empty string',
                    code: 'VALIDATION_ERROR',
                });
                return;
            }
            updateData.firstName = displayName.trim();
        }

        if (tonAddress !== undefined) {
            if (tonAddress !== null && typeof tonAddress !== 'string') {
                res.status(400).json({
                    success: false,
                    error: 'tonAddress must be a string or null',
                    code: 'VALIDATION_ERROR',
                });
                return;
            }
            // Basic TON address validation (raw or base64)
            if (tonAddress && tonAddress.length < 30) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid TON address format',
                    code: 'VALIDATION_ERROR',
                });
                return;
            }
            updateData.tonAddress = tonAddress;
        }

        if (Object.keys(updateData).length === 0) {
            res.status(400).json({
                success: false,
                error: 'No valid fields to update',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const updated = await prisma.user.update({
            where: { telegramId: tgId },
            data: updateData,
        });

        res.json({
            success: true,
            data: {
                id: updated.id,
                telegramId: updated.telegramId,
                firstName: updated.firstName,
                lastName: updated.lastName,
                username: updated.username,
                tonAddress: updated.tonAddress,
                kycStatus: updated.kycStatus,
                maxTradeAmount: updated.maxTradeAmount,
                reputationScore: updated.reputationScore,
            },
        });
    } catch (err) {
        console.error('PUT /users/me error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/users/:id/reputation — Public reputation for a user
 */
usersRouter.get('/:id/reputation', async (req: Request, res: Response) => {
    try {
        const reputation = await reputationService.getReputation(req.params.id as string);

        if (!reputation) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        res.json({ success: true, data: reputation });
    } catch (err) {
        console.error('GET /users/:id/reputation error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});
