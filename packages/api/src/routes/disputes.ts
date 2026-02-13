import { Router, Request, Response } from 'express';
import { prisma } from '@ibis/shared';
import { notificationService } from '../services/notificationService';

export const disputesRouter = Router();

const VALID_DISPUTE_REASONS = [
    'payment_not_received',
    'payment_not_confirmed',
    'wrong_amount',
    'scam_attempt',
    'unresponsive',
    'other',
];

const DISPUTABLE_TRADE_STATUSES = ['ESCROW_LOCKED', 'FIAT_SENT', 'RELEASING'];

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
 * POST /api/disputes - Raise a dispute on a trade
 */
disputesRouter.post('/', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const { tradeId, reason, description } = req.body || {};

        // Validate tradeId
        if (!tradeId || typeof tradeId !== 'string') {
            res.status(400).json({
                success: false,
                error: 'tradeId is required',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate reason
        if (!reason || !VALID_DISPUTE_REASONS.includes(reason)) {
            res.status(400).json({
                success: false,
                error: `reason must be one of: ${VALID_DISPUTE_REASONS.join(', ')}`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate description
        if (!description || typeof description !== 'string') {
            res.status(400).json({
                success: false,
                error: 'description is required',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        if (description.trim().length < 20) {
            res.status(400).json({
                success: false,
                error: 'description must be at least 20 characters',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        if (description.trim().length > 1000) {
            res.status(400).json({
                success: false,
                error: 'description must be at most 1000 characters',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Fetch trade
        const trade = await prisma.trade.findUnique({
            where: { id: tradeId },
            include: { buyer: true, seller: true },
        });

        if (!trade) {
            res.status(404).json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' });
            return;
        }

        // Only trade participants can raise a dispute
        const isBuyer = trade.buyerId === user.id;
        const isSeller = trade.sellerId === user.id;
        if (!isBuyer && !isSeller) {
            res.status(403).json({
                success: false,
                error: 'Only trade participants can raise a dispute',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        // Only active trades can be disputed
        if (!DISPUTABLE_TRADE_STATUSES.includes(trade.status)) {
            res.status(400).json({
                success: false,
                error: `Cannot dispute a trade in ${trade.status} state`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Determine the counterparty
        const againstUserId = isBuyer ? trade.sellerId : trade.buyerId;

        // Create dispute and update trade status in a transaction
        const dispute = await prisma.$transaction(async (tx) => {
            const created = await tx.dispute.create({
                data: {
                    tradeId,
                    raisedBy: user.id,
                    againstUser: againstUserId,
                    reason,
                    description: description.trim(),
                    status: 'open',
                    evidence: [],
                },
            });

            await tx.trade.update({
                where: { id: tradeId },
                data: {
                    status: 'DISPUTED',
                    disputedAt: new Date(),
                    disputeReason: reason,
                },
            });

            return created;
        });

        // Notify counterparty and admins
        notificationService.publishTradeEvent({
            type: 'TRADE_DISPUTED',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
            extra: { reason, disputeId: dispute.id, disputedBy: tgId },
        });

        notificationService.notifyAdmins(
            `New dispute raised on trade ${trade.id} by user ${user.firstName} (${tgId}): ${reason}`,
            { disputeId: dispute.id, tradeId: trade.id },
        );

        res.status(201).json({ success: true, data: dispute });
    } catch (err) {
        console.error('POST /disputes error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/disputes/:id/evidence - Add evidence to a dispute
 */
disputesRouter.post('/:id/evidence', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const dispute = await prisma.dispute.findUnique({
            where: { id: req.params.id as string },
        });

        if (!dispute) {
            res.status(404).json({ success: false, error: 'Dispute not found', code: 'NOT_FOUND' });
            return;
        }

        // Only dispute participants can add evidence
        if (dispute.raisedBy !== user.id && dispute.againstUser !== user.id) {
            res.status(403).json({
                success: false,
                error: 'Only dispute participants can add evidence',
                code: 'UNAUTHORIZED',
            });
            return;
        }

        // Only open or under_review disputes can receive evidence
        if (dispute.status !== 'open' && dispute.status !== 'under_review') {
            res.status(400).json({
                success: false,
                error: 'Cannot add evidence to a resolved or dismissed dispute',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        const { text, txHash } = req.body || {};

        if (!text && !txHash) {
            res.status(400).json({
                success: false,
                error: 'Provide either text or txHash as evidence',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Build evidence entry
        const evidenceEntry: Record<string, string> = {
            submittedBy: user.id,
            submittedAt: new Date().toISOString(),
        };
        if (text) evidenceEntry.text = String(text).trim();
        if (txHash) evidenceEntry.txHash = String(txHash).trim();

        // Append to existing evidence array
        const currentEvidence = Array.isArray(dispute.evidence) ? (dispute.evidence as Record<string, unknown>[]) : [];
        const updatedEvidence = [...currentEvidence, evidenceEntry] as unknown as import('@prisma/client').Prisma.InputJsonValue;

        const updated = await prisma.dispute.update({
            where: { id: req.params.id as string },
            data: { evidence: updatedEvidence },
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('POST /disputes/:id/evidence error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/disputes/:id - View a dispute (participants + admins only)
 */
disputesRouter.get('/:id', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });

        const dispute = await prisma.dispute.findUnique({
            where: { id: req.params.id as string },
            include: {
                trade: {
                    include: {
                        buyer: {
                            select: { id: true, firstName: true, username: true, telegramId: true },
                        },
                        seller: {
                            select: { id: true, firstName: true, username: true, telegramId: true },
                        },
                    },
                },
                raiser: {
                    select: { id: true, firstName: true, username: true },
                },
                target: {
                    select: { id: true, firstName: true, username: true },
                },
            },
        });

        if (!dispute) {
            res.status(404).json({ success: false, error: 'Dispute not found', code: 'NOT_FOUND' });
            return;
        }

        // Access check: participants or admins
        const isParticipant = user && (dispute.raisedBy === user.id || dispute.againstUser === user.id);
        const adminIds = getAdminIds();
        const isAdmin = adminIds.includes(tgId) || (user && user.isAdmin);

        if (!isParticipant && !isAdmin) {
            res.status(403).json({ success: false, error: 'Access denied', code: 'UNAUTHORIZED' });
            return;
        }

        res.json({ success: true, data: dispute });
    } catch (err) {
        console.error('GET /disputes/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/my/disputes - List my disputes
 * Note: This is mounted on the disputesRouter but the full path
 * will be handled via a separate mount point for /api/my/disputes
 * or we use a query-based approach. We handle it here with
 * a special path prefix.
 */

// We export a separate router for /api/my routes
export const myDisputesRouter = Router();

myDisputesRouter.get('/disputes', async (req: Request, res: Response) => {
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
            OR: [{ raisedBy: user.id }, { againstUser: user.id }],
        };

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
                        select: { id: true, firstName: true, username: true },
                    },
                    target: {
                        select: { id: true, firstName: true, username: true },
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
        console.error('GET /my/disputes error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});
