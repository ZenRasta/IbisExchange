import { Request, Response, NextFunction } from 'express';
import { prisma } from '@ibis/shared';

export async function checkBanned(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.telegramUser) {
        next();
        return;
    }

    try {
        const user = await prisma.user.findUnique({
            where: { telegramId: req.telegramUser.id },
            select: { isBanned: true, banType: true, banExpiresAt: true, banReason: true },
        });

        if (user?.isBanned) {
            // Check if temporary ban has expired
            if (user.banType === 'temporary' && user.banExpiresAt && user.banExpiresAt < new Date()) {
                await prisma.user.update({
                    where: { telegramId: req.telegramUser.id },
                    data: { isBanned: false, banType: null, banExpiresAt: null, banReason: null },
                });
                next();
                return;
            }

            res.status(403).json({
                success: false,
                error: 'Account suspended',
                code: 'BANNED',
                reason: user.banReason,
                banType: user.banType,
                expiresAt: user.banExpiresAt,
            });
            return;
        }
    } catch (err) {
        // Don't block on ban check errors
        console.error('Ban check error:', err);
    }

    next();
}
