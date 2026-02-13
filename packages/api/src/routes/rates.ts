import { Router, Request, Response } from 'express';
import { prisma, SUPPORTED_CURRENCIES } from '@ibis/shared';

export const ratesRouter = Router();

/**
 * GET /api/rates/average - Average sell rate for each currency
 */
ratesRouter.get('/average', async (_req: Request, res: Response) => {
    try {
        // Get all active sell orders grouped by currency
        const orders = await prisma.order.findMany({
            where: {
                type: 'SELL',
                status: { in: ['ACTIVE', 'PARTIALLY_MATCHED'] },
            },
            select: {
                currency: true,
                pricePerUsdt: true,
                remainingAmount: true,
            },
        });

        const averages: Record<string, { avgSellRate: number; orderCount: number; minRate: number; maxRate: number; updated: string }> = {};

        // Group by currency and calculate averages
        const grouped: Record<string, { prices: number[]; amounts: number[] }> = {};
        for (const order of orders) {
            if (!grouped[order.currency]) {
                grouped[order.currency] = { prices: [], amounts: [] };
            }
            grouped[order.currency].prices.push(order.pricePerUsdt);
            grouped[order.currency].amounts.push(order.remainingAmount);
        }

        for (const [currency, data] of Object.entries(grouped)) {
            if (data.prices.length === 0) continue;
            const sum = data.prices.reduce((a, b) => a + b, 0);
            averages[currency] = {
                avgSellRate: Math.round((sum / data.prices.length) * 100) / 100,
                orderCount: data.prices.length,
                minRate: Math.min(...data.prices),
                maxRate: Math.max(...data.prices),
                updated: new Date().toISOString(),
            };
        }

        // Add empty entries for supported currencies with no orders
        for (const code of Object.keys(SUPPORTED_CURRENCIES)) {
            if (!averages[code]) {
                averages[code] = {
                    avgSellRate: 0,
                    orderCount: 0,
                    minRate: 0,
                    maxRate: 0,
                    updated: new Date().toISOString(),
                };
            }
        }

        res.json({ success: true, data: { averages } });
    } catch (err) {
        console.error('GET /rates/average error:', err);
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
});
