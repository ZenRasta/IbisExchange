import { Router } from 'express';
import { veriff } from '../services/veriffService';
import { prisma } from '@ibis/shared';

export const kycRouter = Router();

// Check KYC status
kycRouter.get('/status', async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { telegramId: req.telegramUser!.id },
        select: { kycStatus: true, kycVerifiedAt: true },
    });
    res.json({
        success: true,
        data: {
            status: user?.kycStatus || 'NOT_STARTED',
            verifiedAt: user?.kycVerifiedAt,
        },
    });
});

// Start verification — creates Veriff session, returns session URL
kycRouter.post('/start', async (req, res) => {
    const tgId = req.telegramUser!.id;
    const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.kycStatus === 'VERIFIED')
        return res.json({ success: true, data: { status: 'already_verified' } });

    try {
        const session = await veriff.createSession(
            tgId,
            req.telegramUser!.first_name,
            req.telegramUser!.last_name
        );

        // Store the Veriff session ID as the applicant ID
        await prisma.user.update({
            where: { telegramId: tgId },
            data: {
                kycApplicantId: session.verification.id,
                kycStatus: 'PENDING',
            },
        });

        res.json({
            success: true,
            data: {
                sessionUrl: session.verification.url,
                sessionId: session.verification.id,
            },
        });
    } catch (err: any) {
        console.error('Veriff session error:', err);
        res.status(500).json({ success: false, error: 'Failed to create verification session' });
    }
});
