import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { tonMonitor } from '../services/tonMonitor';

export const webhooksRouter = Router();

/**
 * POST /api/webhooks/ton — Receive TON transaction webhook from TonAPI
 *
 * TonAPI sends POST requests when transactions occur on subscribed addresses.
 * This is the real-time alternative to polling.
 */
webhooksRouter.post('/ton', async (req: Request, res: Response) => {
    try {
        // Validate TonAPI webhook signature if TONAPI_KEY is configured
        // TonAPI uses the API key for webhook authentication
        const apiKey = process.env.TONAPI_KEY;
        if (apiKey) {
            const signature = req.headers['x-tonapi-signature'] as string;
            if (signature) {
                // Verify the webhook is from TonAPI
                const payload = JSON.stringify(req.body);
                const expected = crypto
                    .createHmac('sha256', apiKey)
                    .update(payload)
                    .digest('hex');

                if (signature !== expected) {
                    console.warn('TON Webhook: Invalid signature');
                    res.status(401).json({ success: false, error: 'Invalid signature' });
                    return;
                }
            }
        }

        const { event_type, event } = req.body || {};

        if (!event_type || !event) {
            res.status(400).json({ success: false, error: 'Invalid webhook payload' });
            return;
        }

        console.log(`TON Webhook: Received ${event_type} event`);

        // Handle Jetton transfer events
        if (event_type === 'jetton_transfer' || event_type === 'transaction') {
            const {
                comment,
                amount,
                sender,
                tx_hash,
            } = event;

            // The escrow ID should be in the comment/forward payload
            if (comment) {
                const escrowId = parseInt(comment, 10);
                if (!isNaN(escrowId) && amount) {
                    const amountBigInt = BigInt(amount);
                    await tonMonitor.matchDepositToTrade(
                        escrowId,
                        amountBigInt,
                        sender?.address || '',
                        tx_hash
                    );
                }
            }
        }

        res.status(200).json({ success: true });
    } catch (err) {
        console.error('TON Webhook error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/webhooks/health — Health check for webhook endpoint
 */
webhooksRouter.get('/health', (_req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            status: 'ok',
            timestamp: new Date().toISOString(),
        },
    });
});
