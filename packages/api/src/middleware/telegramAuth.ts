import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Validates the Telegram initData sent from the Mini App.
 * Algorithm follows https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * 1. Parse as URLSearchParams
 * 2. Extract and remove `hash`
 * 3. Sort remaining params alphabetically
 * 4. Create data_check_string: `key=value\nkey=value\n...`
 * 5. Secret key: HMAC-SHA256("WebAppData", BOT_TOKEN)
 * 6. Computed hash: HMAC-SHA256(secret_key, data_check_string)
 * 7. Compare computed hash to extracted hash
 * 8. Check auth_date is within 24 hours
 */
export function telegramAuth(req: Request, res: Response, next: NextFunction): void {
    const initData = req.headers['x-telegram-init-data'] as string;
    if (!initData) {
        res.status(401).json({ success: false, error: 'Missing initData', code: 'UNAUTHORIZED' });
        return;
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
        res.status(401).json({ success: false, error: 'Missing hash', code: 'UNAUTHORIZED' });
        return;
    }

    params.delete('hash');
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(process.env.BOT_TOKEN!)
        .digest();

    const computed = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    if (computed !== hash) {
        res.status(401).json({ success: false, error: 'Invalid signature', code: 'UNAUTHORIZED' });
        return;
    }

    // Check not expired (24 hour window)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (Math.floor(Date.now() / 1000) - authDate > 86400) {
        res.status(401).json({ success: false, error: 'Expired initData', code: 'UNAUTHORIZED' });
        return;
    }

    const userParam = params.get('user');
    if (!userParam) {
        res.status(401).json({ success: false, error: 'No user data', code: 'UNAUTHORIZED' });
        return;
    }

    try {
        req.telegramUser = JSON.parse(decodeURIComponent(userParam));
    } catch {
        res.status(401).json({ success: false, error: 'Invalid user data', code: 'UNAUTHORIZED' });
        return;
    }

    next();
}

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            telegramUser?: {
                id: number;
                first_name: string;
                last_name?: string;
                username?: string;
                language_code?: string;
                is_premium?: boolean;
            };
        }
    }
}
