import { Router } from 'express';
import express from 'express';
import { veriff } from '../services/veriffService';
import { prisma } from '@ibis/shared';

export const kycWebhookRouter = Router();

kycWebhookRouter.post('/veriff', express.raw({ type: 'application/json' }), async (req, res) => {
    const raw = req.body.toString('utf-8');
    const signature = req.headers['x-hmac-signature'] as string;

    if (!signature || !veriff.isValidWebhookSignature(raw, signature)) {
        return res.status(401).send('Invalid signature');
    }

    const payload = JSON.parse(raw);
    const verification = payload.verification;

    if (!verification || !verification.vendorData) {
        return res.status(400).send('Missing verification data');
    }

    const tgId = parseInt(verification.vendorData, 10);
    if (isNaN(tgId)) {
        return res.status(400).send('Invalid vendorData');
    }

    const status = verification.status;

    try {
        if (status === 'approved') {
            await prisma.user.update({
                where: { telegramId: tgId },
                data: {
                    kycStatus: 'VERIFIED',
                    kycVerifiedAt: new Date(),
                    maxTradeAmount: 10000,
                },
            });
        } else if (status === 'resubmission_requested') {
            await prisma.user.update({
                where: { telegramId: tgId },
                data: { kycStatus: 'ACTION_REQUIRED' },
            });
        } else if (status === 'declined') {
            await prisma.user.update({
                where: { telegramId: tgId },
                data: {
                    kycStatus: 'REJECTED',
                    kycComment: verification.reason || 'Verification declined',
                },
            });
        } else if (status === 'expired' || status === 'abandoned') {
            await prisma.user.update({
                where: { telegramId: tgId },
                data: { kycStatus: 'NOT_STARTED' },
            });
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error('Veriff webhook processing error:', err);
        res.status(500).send('Internal error');
    }
});
