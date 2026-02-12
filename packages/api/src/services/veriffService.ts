import crypto from 'crypto';

const BASE = 'https://api.veriff.me';
const API_KEY = process.env.VERIF_APP_TOKEN!;
const SECRET = process.env.VERIF_SECRET_KEY!;

interface VeriffSessionResponse {
    status: string;
    verification: {
        id: string;
        url: string;
        sessionToken: string;
        baseUrl: string;
    };
}

export const veriff = {
    /**
     * Create a new verification session.
     * vendorData is the Telegram user ID (used to match webhook back to user).
     */
    createSession: async (
        telegramId: number,
        firstName?: string,
        lastName?: string
    ): Promise<VeriffSessionResponse> => {
        const body = JSON.stringify({
            verification: {
                callback: `${process.env.WEBHOOK_DOMAIN}/api/webhooks/veriff`,
                person: {
                    firstName: firstName || 'User',
                    lastName: lastName || String(telegramId),
                },
                vendorData: String(telegramId),
                timestamp: new Date().toISOString(),
            },
        });

        const res = await fetch(`${BASE}/v1/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-AUTH-CLIENT': API_KEY,
            },
            body,
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Veriff session creation failed: ${res.status} ${err}`);
        }

        return (await res.json()) as VeriffSessionResponse;
    },

    /**
     * Get session decision (for checking status on demand).
     */
    getSessionDecision: async (sessionId: string): Promise<any> => {
        const res = await fetch(`${BASE}/v1/sessions/${sessionId}/decision`, {
            headers: {
                'X-AUTH-CLIENT': API_KEY,
                'X-HMAC-SIGNATURE': crypto
                    .createHmac('sha256', SECRET)
                    .update(Buffer.from(sessionId, 'utf8'))
                    .digest('hex'),
            },
        });
        return res.json();
    },

    /**
     * Validate webhook HMAC signature.
     */
    isValidWebhookSignature: (payload: string, signature: string): boolean => {
        const computed = crypto
            .createHmac('sha256', SECRET)
            .update(Buffer.from(payload, 'utf8'))
            .digest('hex');
        try {
            return crypto.timingSafeEqual(
                Buffer.from(computed, 'hex'),
                Buffer.from(signature, 'hex')
            );
        } catch {
            return false;
        }
    },
};
