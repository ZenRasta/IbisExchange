import { Router, Request, Response } from 'express';
import { prisma } from '@ibis/shared';

export const reviewsRouter = Router();

/**
 * POST /api/reviews - Create a review for a completed trade
 */
reviewsRouter.post('/', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const { tradeId, vote, comment } = req.body || {};

        // Validate vote
        if (!vote || (vote !== 'up' && vote !== 'down')) {
            res.status(400).json({
                success: false,
                error: 'vote must be "up" or "down"',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate tradeId
        if (!tradeId || typeof tradeId !== 'string') {
            res.status(400).json({
                success: false,
                error: 'tradeId is required',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate comment length
        if (comment !== undefined && comment !== null) {
            if (typeof comment !== 'string' || comment.length > 280) {
                res.status(400).json({
                    success: false,
                    error: 'Comment must be a string of at most 280 characters',
                    code: 'VALIDATION_ERROR',
                });
                return;
            }
        }

        // Fetch trade
        const trade = await prisma.trade.findUnique({
            where: { id: tradeId },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        // Only completed trades can be reviewed
        const reviewableStatuses = ['COMPLETED', 'RESOLVED_RELEASE', 'RESOLVED_REFUND'];
        if (!reviewableStatuses.includes(trade.status)) {
            res.status(400).json({
                success: false,
                error: 'Can only review completed trades',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Only trade participants can review
        const isBuyer = trade.buyerId === user.id;
        const isSeller = trade.sellerId === user.id;
        if (!isBuyer && !isSeller) {
            res.status(403).json({
                success: false,
                error: 'Only trade participants can leave reviews',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        // Determine reviewee (the counterparty)
        const revieweeId = isBuyer ? trade.sellerId : trade.buyerId;

        // Check for existing review (unique constraint: tradeId + reviewerId)
        const existing = await prisma.tradeReview.findUnique({
            where: { tradeId_reviewerId: { tradeId, reviewerId: user.id } },
        });

        if (existing) {
            res.status(400).json({
                success: false,
                error: 'You have already reviewed this trade',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Create review and update reviewee's vote counts in a transaction
        const review = await prisma.$transaction(async (tx) => {
            const created = await tx.tradeReview.create({
                data: {
                    tradeId,
                    reviewerId: user.id,
                    revieweeId,
                    vote,
                    comment: comment ? comment.trim() : null,
                },
            });

            // Update reviewee upvotes/downvotes
            if (vote === 'up') {
                await tx.user.update({
                    where: { id: revieweeId },
                    data: { totalUpvotes: { increment: 1 } },
                });
            } else {
                await tx.user.update({
                    where: { id: revieweeId },
                    data: { totalDownvotes: { increment: 1 } },
                });
            }

            return created;
        });

        res.status(201).json({ success: true, data: review });
    } catch (err) {
        console.error('POST /reviews error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/reviews/:userId - Get reviews for a user
 */
reviewsRouter.get('/:userId', async (req: Request, res: Response) => {
    try {
        const userId = req.params.userId as string;

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;

        // Check user exists
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                username: true,
                totalUpvotes: true,
                totalDownvotes: true,
                reputationScore: true,
            },
        });

        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const [reviews, total] = await Promise.all([
            prisma.tradeReview.findMany({
                where: { revieweeId: userId },
                orderBy: { createdAt: 'desc' },
                include: {
                    reviewer: {
                        select: {
                            id: true,
                            firstName: true,
                            username: true,
                        },
                    },
                },
                skip,
                take: limit,
            }),
            prisma.tradeReview.count({ where: { revieweeId: userId } }),
        ]);

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    firstName: user.firstName,
                    username: user.username,
                    totalUpvotes: user.totalUpvotes,
                    totalDownvotes: user.totalDownvotes,
                    reputationScore: user.reputationScore,
                },
                reviews,
            },
            pagination: { page, limit, total },
        });
    } catch (err) {
        console.error('GET /reviews/:userId error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});
