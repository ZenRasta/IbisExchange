import { Router, Request, Response } from 'express';
import { prisma, getReputationTier } from '@ibis/shared';

export const leaderboardRouter = Router();

/**
 * GET /api/users/leaderboard - Public leaderboard
 * Query params: sort (reputation|trades|volume|newest), page, limit, search
 */
leaderboardRouter.get('/', async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;
        const sort = (req.query.sort as string) || 'reputation';
        const search = (req.query.search as string) || '';

        // Determine sort order
        let orderBy: Record<string, string>;
        switch (sort) {
            case 'trades':
                orderBy = { totalTrades: 'desc' };
                break;
            case 'volume':
                orderBy = { totalVolume: 'desc' };
                break;
            case 'newest':
                orderBy = { createdAt: 'desc' };
                break;
            case 'reputation':
            default:
                orderBy = { reputationScore: 'desc' };
                break;
        }

        // Build where clause - exclude banned users
        const where: Record<string, unknown> = {
            isBanned: false,
        };

        // Search by username or firstName
        if (search.trim()) {
            where.OR = [
                { username: { contains: search.trim(), mode: 'insensitive' } },
                { firstName: { contains: search.trim(), mode: 'insensitive' } },
            ];
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                orderBy,
                select: {
                    id: true,
                    username: true,
                    firstName: true,
                    reputationScore: true,
                    totalTrades: true,
                    totalVolume: true,
                    totalUpvotes: true,
                    totalDownvotes: true,
                    kycStatus: true,
                    createdAt: true,
                },
                skip,
                take: limit,
            }),
            prisma.user.count({ where }),
        ]);

        // Add computed reputation tier
        const leaderboard = users.map((user) => {
            const tier = getReputationTier(user.totalTrades, user.reputationScore);
            return {
                ...user,
                reputationTier: tier,
            };
        });

        res.json({
            success: true,
            data: leaderboard,
            pagination: { page, limit, total },
        });
    } catch (err) {
        console.error('GET /users/leaderboard error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});
