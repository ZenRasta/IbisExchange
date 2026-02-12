import { prisma } from '@ibis/shared';
import type { Trade } from '@prisma/client';

export interface ReputationSummary {
    userId: string;
    reputationScore: number;
    totalTrades: number;
    successfulTrades: number;
    successRate: number;
    totalVolume: number;
    kycVerified: boolean;
}

export class ReputationService {
    /**
     * Update reputation for both buyer and seller after a completed trade.
     * Score = (successfulTrades / totalTrades) * 5, weighted by volume.
     */
    async recordCompletedTrade(trade: Trade): Promise<void> {
        // Update both buyer and seller
        for (const userId of [trade.buyerId, trade.sellerId]) {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) continue;

            const newTotalTrades = user.totalTrades + 1;
            const newSuccessfulTrades = user.successfulTrades + 1;
            const newTotalVolume = user.totalVolume + trade.amount;

            // Reputation formula: (successful / total) * 5
            // Weighted — at least 3 trades to get meaningful score
            const rawScore = (newSuccessfulTrades / newTotalTrades) * 5;
            // Apply volume weight: trades above 100 USDT get a slight boost
            const volumeWeight = Math.min(1.0, Math.log10(newTotalVolume + 1) / 4);
            const reputationScore = Math.round(rawScore * (0.7 + 0.3 * volumeWeight) * 100) / 100;

            await prisma.user.update({
                where: { id: userId },
                data: {
                    totalTrades: newTotalTrades,
                    successfulTrades: newSuccessfulTrades,
                    totalVolume: newTotalVolume,
                    reputationScore: Math.min(5.0, reputationScore),
                },
            });
        }
    }

    /**
     * Record a dispute outcome — penalize the losing party.
     */
    async recordDispute(trade: Trade, loser: 'buyer' | 'seller'): Promise<void> {
        const loserId = loser === 'buyer' ? trade.buyerId : trade.sellerId;
        const winnerId = loser === 'buyer' ? trade.sellerId : trade.buyerId;

        // Loser: increment total trades but not successful
        const loserUser = await prisma.user.findUnique({ where: { id: loserId } });
        if (loserUser) {
            const newTotal = loserUser.totalTrades + 1;
            const rawScore = (loserUser.successfulTrades / newTotal) * 5;
            await prisma.user.update({
                where: { id: loserId },
                data: {
                    totalTrades: newTotal,
                    reputationScore: Math.max(0, Math.round(rawScore * 100) / 100),
                },
            });
        }

        // Winner: treated same as completed trade
        const winnerUser = await prisma.user.findUnique({ where: { id: winnerId } });
        if (winnerUser) {
            const newTotal = winnerUser.totalTrades + 1;
            const newSuccessful = winnerUser.successfulTrades + 1;
            const rawScore = (newSuccessful / newTotal) * 5;
            await prisma.user.update({
                where: { id: winnerId },
                data: {
                    totalTrades: newTotal,
                    successfulTrades: newSuccessful,
                    reputationScore: Math.min(5.0, Math.round(rawScore * 100) / 100),
                },
            });
        }
    }

    /**
     * Get a user's public reputation summary.
     */
    async getReputation(userId: string): Promise<ReputationSummary | null> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                reputationScore: true,
                totalTrades: true,
                successfulTrades: true,
                totalVolume: true,
                kycStatus: true,
            },
        });

        if (!user) return null;

        return {
            userId: user.id,
            reputationScore: user.reputationScore,
            totalTrades: user.totalTrades,
            successfulTrades: user.successfulTrades,
            successRate:
                user.totalTrades > 0
                    ? Math.round((user.successfulTrades / user.totalTrades) * 100)
                    : 0,
            totalVolume: user.totalVolume,
            kycVerified: user.kycStatus === 'VERIFIED',
        };
    }

    /**
     * Check if a user can trade the given amount based on reputation and KYC.
     */
    async checkTradeLimit(
        userId: string,
        amount: number
    ): Promise<{ allowed: boolean; maxAmount: number; reason?: string }> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { maxTradeAmount: true, kycStatus: true },
        });

        if (!user) {
            return { allowed: false, maxAmount: 0, reason: 'User not found' };
        }

        if (amount > user.maxTradeAmount) {
            return {
                allowed: false,
                maxAmount: user.maxTradeAmount,
                reason:
                    user.kycStatus === 'VERIFIED'
                        ? `Amount exceeds your trade limit of ${user.maxTradeAmount} USDT`
                        : `Unverified users can trade up to ${user.maxTradeAmount} USDT. Complete KYC to increase your limit.`,
            };
        }

        return { allowed: true, maxAmount: user.maxTradeAmount };
    }
}

export const reputationService = new ReputationService();
