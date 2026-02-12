# Agent 6 Prompt: KYC Verification System (Veriff)

## Copy everything below this line into Claude Code:

---

You are the **KYC Agent** for Project Ibis — a Telegram P2P USDT exchange. Integrate Veriff for optional identity verification. Users upload government ID + selfie. Verified users get higher trade limits (10,000 vs 500 USDT).

**Read:** `/var/www/ibis/reference-docs/KYC_REFERENCE.md`
**Wait for:** `/var/www/ibis/.agent-1-complete`

## Your Files

- `packages/api/src/services/veriffService.ts` — Veriff API client
- `packages/api/src/routes/kyc.ts` — KYC endpoints (export Router for Agent 4 to mount)
- `packages/mini-app/src/components/VeriffKyc.tsx` — Frontend InContext SDK component
- Add Veriff webhook handler to `packages/api/src/routes/webhooks.ts`

## Backend: Veriff Service

```typescript
// packages/api/src/services/veriffService.ts
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

        return res.json();
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
```

## Backend: KYC Routes

```typescript
// packages/api/src/routes/kyc.ts
import { Router } from 'express';
import { veriff } from '../services/veriffService';
import prisma from '@ibis/shared/db';

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
```

Agent 4 must mount this: `app.use('/api/kyc', telegramAuth, kycRouter);`

## Backend: Webhook Handler

Add to `packages/api/src/routes/webhooks.ts`:

```typescript
import { veriff } from '../services/veriffService';

webhooksRouter.post('/veriff', express.raw({ type: 'application/json' }), async (req, res) => {
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
```

## Frontend: Veriff React Component

```tsx
// packages/mini-app/src/components/VeriffKyc.tsx
import { useState, useEffect, useCallback } from 'react';
import { createVeriffFrame } from '@veriff/incontext-sdk';
import { apiCall } from '../lib/api';

export function VeriffKyc({ onComplete }: { onComplete?: () => void }) {
    const [state, setState] = useState<'loading' | 'ready' | 'verifying' | 'done' | 'error'>('loading');

    useEffect(() => {
        startKyc();
    }, []);

    async function startKyc() {
        try {
            const data = await apiCall<any>('POST', '/api/kyc/start');

            if (data.status === 'already_verified') {
                setState('done');
                return;
            }

            setState('ready');

            // Launch Veriff InContext SDK with the session URL
            createVeriffFrame({
                url: data.sessionUrl,
                onEvent: (msg: string) => {
                    switch (msg) {
                        case 'STARTED':
                            setState('verifying');
                            break;
                        case 'SUBMITTED':
                        case 'FINISHED':
                            setState('done');
                            onComplete?.();
                            break;
                        case 'CANCELED':
                            setState('ready');
                            break;
                    }
                },
            });
        } catch {
            setState('error');
        }
    }

    if (state === 'loading')
        return (
            <div className="flex justify-center p-8">
                <div className="animate-spin h-8 w-8 border-2 border-tg-button border-t-transparent rounded-full" />
            </div>
        );

    if (state === 'done')
        return (
            <div className="text-center p-8">
                <p className="text-4xl mb-3">&#x2705;</p>
                <p className="text-tg-text font-medium">Verification submitted!</p>
                <p className="text-tg-hint text-sm mt-2">We'll notify you when the review is complete.</p>
            </div>
        );

    if (state === 'error')
        return (
            <div className="text-center p-8">
                <p className="text-tg-destructive">
                    Failed to load verification.{' '}
                    <button onClick={startKyc} className="underline">
                        Retry
                    </button>
                </p>
            </div>
        );

    // 'ready' or 'verifying' — the InContext SDK frame is rendering
    return (
        <div className="p-4">
            <p className="text-tg-hint text-sm text-center mb-4">
                Complete identity verification to unlock higher trade limits.
            </p>
            <div id="veriff-root" className="min-h-[400px]" />
        </div>
    );
}
```

Install: `cd packages/mini-app && npm install @veriff/incontext-sdk`

## Veriff Dashboard Setup (Human Must Do)

1. Sign up at veriff.com
2. Create an integration in Veriff Station
3. Get API Key → save as `VERIF_APP_TOKEN` in .env
4. Get Shared Secret → save as `VERIF_SECRET_KEY` in .env
5. Configure webhook URL: `https://domain/api/webhooks/veriff`
6. Enable decision webhooks
7. Set document requirements: Government ID (TTO) + Selfie with face match

## Acceptance Criteria

- [ ] POST /api/kyc/start creates a Veriff session and returns sessionUrl
- [ ] VeriffKyc component embeds Veriff InContext SDK in Mini App
- [ ] Decision webhook updates KYC status correctly (approved→VERIFIED, declined→REJECTED, resubmission_requested→ACTION_REQUIRED)
- [ ] Verified users get maxTradeAmount = 10000
- [ ] Webhook HMAC signature validation works
- [ ] Expired/abandoned sessions reset status to NOT_STARTED

## Signal Completion

Create `/var/www/ibis/.agent-6-complete`:
```
AGENT_6_COMPLETE=true
TIMESTAMP=<ISO>
ROUTES=/api/kyc/status,/api/kyc/start
WEBHOOK=/api/webhooks/veriff
NOTES=<remind human to set up Veriff dashboard>
```
