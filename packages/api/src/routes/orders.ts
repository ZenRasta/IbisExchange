import { Router, Request, Response } from 'express';
import {
    prisma,
    MIN_TRADE_USDT,
    MAX_TRADE_USDT_UNVERIFIED,
    MAX_TRADE_USDT_VERIFIED,
    SUPPORTED_PAYMENT_METHODS,
    SUPPORTED_CURRENCIES,
    CURRENCY_CODES,
} from '@ibis/shared';
import type { CurrencyCode } from '@ibis/shared';
import { matchingEngine } from '../services/matchingEngine';

export const ordersRouter = Router();

/**
 * GET /api/orders — List active orders (paginated, filterable)
 */
ordersRouter.get('/', async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;

        const type = req.query.type as string | undefined;
        const paymentMethod = req.query.paymentMethod as string | undefined;
        const minAmount = parseFloat(req.query.minAmount as string) || undefined;
        const maxAmount = parseFloat(req.query.maxAmount as string) || undefined;
        const currency = req.query.currency as string | undefined;

        const mine = req.query.mine === 'true';
        const where: Record<string, unknown> = {
            status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] },
        };

        // Filter to user's own orders
        if (mine) {
            const tgId = req.telegramUser!.id;
            const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
            if (user) {
                where.userId = user.id;
            }
            // When filtering own orders, include all statuses
            const statusFilter = req.query.status as string | undefined;
            if (statusFilter) {
                where.status = statusFilter;
            }
        }

        if (type && (type === 'BUY' || type === 'SELL')) {
            where.type = type;
        }

        if (paymentMethod) {
            where.paymentMethods = { has: paymentMethod };
        }

        // Filter by currency
        if (currency && (CURRENCY_CODES as readonly string[]).includes(currency)) {
            where.currency = currency;
        }

        if (minAmount !== undefined || maxAmount !== undefined) {
            where.remainingAmount = {};
            if (minAmount !== undefined) (where.remainingAmount as Record<string, number>).gte = minAmount;
            if (maxAmount !== undefined) (where.remainingAmount as Record<string, number>).lte = maxAmount;
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                orderBy: [
                    { pricePerUsdt: type === 'BUY' ? 'desc' : 'asc' },
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
        console.error('GET /orders error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * POST /api/orders — Create a new order
 */
ordersRouter.post('/', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;

        const {
            type,
            amount,
            pricePerUsdt,
            paymentMethods,
            bankDetails,
            minTradeAmount,
            maxTradeAmount,
            currency: reqCurrency,
        } = req.body;

        // Validate currency (default to TTD)
        const currency: string = reqCurrency || 'TTD';
        if (!(CURRENCY_CODES as readonly string[]).includes(currency)) {
            res.status(400).json({
                success: false,
                error: `Invalid currency: ${currency}. Supported: ${CURRENCY_CODES.join(', ')}`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate type
        if (!type || (type !== 'BUY' && type !== 'SELL')) {
            res.status(400).json({
                success: false,
                error: 'type must be BUY or SELL',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate amount
        if (!amount || typeof amount !== 'number' || amount < MIN_TRADE_USDT) {
            res.status(400).json({
                success: false,
                error: `amount must be at least ${MIN_TRADE_USDT} USDT`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate price
        if (!pricePerUsdt || typeof pricePerUsdt !== 'number' || pricePerUsdt <= 0) {
            res.status(400).json({
                success: false,
                error: 'pricePerUsdt must be a positive number',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate payment methods
        if (!paymentMethods || !Array.isArray(paymentMethods) || paymentMethods.length === 0) {
            res.status(400).json({
                success: false,
                error: 'At least one payment method is required',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Get per-currency payment methods (fall back to legacy list)
        const currencyConfig = SUPPORTED_CURRENCIES[currency as CurrencyCode];
        const validMethods: readonly string[] = currencyConfig
            ? currencyConfig.paymentMethods
            : (SUPPORTED_PAYMENT_METHODS as readonly string[]);
        for (const method of paymentMethods) {
            if (!validMethods.includes(method)) {
                res.status(400).json({
                    success: false,
                    error: `Invalid payment method: ${method}. Supported for ${currency}: ${validMethods.join(', ')}`,
                    code: 'VALIDATION_ERROR',
                });
                return;
            }
        }

        // Find or create user
        let user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    telegramId: tgId,
                    firstName: req.telegramUser!.first_name,
                    lastName: req.telegramUser!.last_name || null,
                    username: req.telegramUser!.username || null,
                },
            });
        }

        // Enforce KYC-based trade limits
        const maxAllowed = user.kycStatus === 'VERIFIED' ? MAX_TRADE_USDT_VERIFIED : MAX_TRADE_USDT_UNVERIFIED;
        if (amount > maxAllowed) {
            res.status(400).json({
                success: false,
                error: user.kycStatus === 'VERIFIED'
                    ? `Maximum order amount is ${MAX_TRADE_USDT_VERIFIED} USDT`
                    : `Unverified users can create orders up to ${MAX_TRADE_USDT_UNVERIFIED} USDT. Complete KYC to increase your limit.`,
                code: 'TRADE_LIMIT_EXCEEDED',
            });
            return;
        }

        // Validate minTradeAmount
        if (minTradeAmount !== undefined && (typeof minTradeAmount !== 'number' || minTradeAmount < MIN_TRADE_USDT)) {
            res.status(400).json({
                success: false,
                error: `minTradeAmount must be at least ${MIN_TRADE_USDT} USDT`,
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Validate maxTradeAmount
        if (maxTradeAmount !== undefined && (typeof maxTradeAmount !== 'number' || maxTradeAmount > amount)) {
            res.status(400).json({
                success: false,
                error: 'maxTradeAmount cannot exceed order amount',
                code: 'VALIDATION_ERROR',
            });
            return;
        }

        // Set expiry to 24 hours from now
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const order = await prisma.order.create({
            data: {
                userId: user.id,
                type: type as 'BUY' | 'SELL',
                amount,
                remainingAmount: amount,
                pricePerUsdt,
                currency,
                paymentMethods,
                bankDetails: bankDetails || null,
                minTradeAmount: minTradeAmount || null,
                maxTradeAmount: maxTradeAmount || null,
                status: 'ACTIVE',
                expiresAt,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        username: true,
                        reputationScore: true,
                        kycStatus: true,
                    },
                },
            },
        });

        res.status(201).json({ success: true, data: order });
    } catch (err) {
        console.error('POST /orders error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * GET /api/orders/:id — Get a single order with user details
 */
ordersRouter.get('/:id', async (req: Request, res: Response) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id as string },
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
        });

        if (!order) {
            res.status(404).json({ success: false, error: 'Order not found', code: 'NOT_FOUND' });
            return;
        }

        res.json({ success: true, data: order });
    } catch (err) {
        console.error('GET /orders/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * PATCH /api/orders/:id — Update own order (price, amount, status)
 */
ordersRouter.patch('/:id', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const order = await prisma.order.findUnique({ where: { id: req.params.id as string } });
        if (!order) {
            res.status(404).json({ success: false, error: 'Order not found', code: 'NOT_FOUND' });
            return;
        }

        if (order.userId !== user.id) {
            res.status(403).json({ success: false, error: 'Not your order', code: 'UNAUTHORIZED' });
            return;
        }

        if (order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.status === 'MATCHED') {
            res.status(400).json({
                success: false,
                error: 'Cannot update a completed/cancelled/expired order',
                code: 'ORDER_NOT_ACTIVE',
            });
            return;
        }

        const updateData: Record<string, unknown> = {};
        const { pricePerUsdt, paymentMethods, bankDetails, minTradeAmount, maxTradeAmount } = req.body;

        if (pricePerUsdt !== undefined) {
            if (typeof pricePerUsdt !== 'number' || pricePerUsdt <= 0) {
                res.status(400).json({
                    success: false,
                    error: 'pricePerUsdt must be a positive number',
                    code: 'VALIDATION_ERROR',
                });
                return;
            }
            updateData.pricePerUsdt = pricePerUsdt;
        }

        if (paymentMethods !== undefined) {
            if (!Array.isArray(paymentMethods) || paymentMethods.length === 0) {
                res.status(400).json({
                    success: false,
                    error: 'At least one payment method required',
                    code: 'VALIDATION_ERROR',
                });
                return;
            }
            updateData.paymentMethods = paymentMethods;
        }

        if (bankDetails !== undefined) {
            updateData.bankDetails = bankDetails;
        }

        if (minTradeAmount !== undefined) {
            updateData.minTradeAmount = minTradeAmount;
        }

        if (maxTradeAmount !== undefined) {
            updateData.maxTradeAmount = maxTradeAmount;
        }

        const updated = await prisma.order.update({
            where: { id: req.params.id as string },
            data: updateData,
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        username: true,
                        reputationScore: true,
                        kycStatus: true,
                    },
                },
            },
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('PATCH /orders/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});

/**
 * DELETE /api/orders/:id — Cancel own order (soft delete)
 */
ordersRouter.delete('/:id', async (req: Request, res: Response) => {
    try {
        const tgId = req.telegramUser!.id;
        const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found', code: 'NOT_FOUND' });
            return;
        }

        const order = await prisma.order.findUnique({ where: { id: req.params.id as string } });
        if (!order) {
            res.status(404).json({ success: false, error: 'Order not found', code: 'NOT_FOUND' });
            return;
        }

        if (order.userId !== user.id) {
            res.status(403).json({ success: false, error: 'Not your order', code: 'UNAUTHORIZED' });
            return;
        }

        if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
            res.status(400).json({
                success: false,
                error: 'Order is already cancelled or expired',
                code: 'ORDER_NOT_ACTIVE',
            });
            return;
        }

        const cancelled = await prisma.order.update({
            where: { id: req.params.id as string },
            data: { status: 'CANCELLED' },
        });

        res.json({ success: true, data: cancelled });
    } catch (err) {
        console.error('DELETE /orders/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});
