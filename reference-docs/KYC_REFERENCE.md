# KYC_REFERENCE.md — Veriff Integration Reference

## Veriff Key Facts

- **API Base:** `https://api.veriff.me`
- **Auth:** `X-AUTH-CLIENT` header (API Key) + HMAC-SHA256 signature
- **JS SDK:** `@veriff/js-sdk` v2.x — creates session and renders form
- **InContext SDK:** `@veriff/incontext-sdk` — embeds verification inline/modal in your page
- **T&T Country Code:** TT
- **Supported T&T Docs:** Passport, National ID Card, Driver's License
- **Env Vars:** `VERIF_APP_TOKEN` (API Key), `VERIF_SECRET_KEY` (Shared Secret)

## API Request Signing

For POST requests, compute signature over the request body + shared secret:
```
X-AUTH-CLIENT: <VERIF_APP_TOKEN>
Content-Type: application/json
```

HMAC Signature for webhooks:
```
x-hmac-signature: HMAC-SHA256(shared_secret, raw_request_body)
```

## Core API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/v1/sessions` | Create verification session |
| GET | `/v1/sessions/{sessionId}` | Get session status |
| GET | `/v1/sessions/{sessionId}/decision` | Get session decision |

## Session Creation

**POST** `https://api.veriff.me/v1/sessions`

Request:
```json
{
  "verification": {
    "callback": "https://yourdomain.com/kyc-complete",
    "person": {
      "firstName": "John",
      "lastName": "Smith"
    },
    "vendorData": "<telegramId>",
    "timestamp": "2026-02-08T12:00:00.000Z"
  }
}
```

Response:
```json
{
  "status": "success",
  "verification": {
    "id": "f04bdb47-d3be-4b28-b028-...",
    "url": "https://magic.veriff.me/v/...",
    "sessionToken": "eyJhbG...",
    "baseUrl": "https://magic.veriff.me"
  }
}
```

The `verification.url` is the session URL used by the InContext SDK to launch the flow.
The `verification.id` is stored as `kycApplicantId` in the User model.

## Decision Webhook Payload

Veriff sends a POST to your webhook URL when a decision is made:

```json
{
  "status": "success",
  "verification": {
    "id": "12df6045-3846-3e45-946a-14fa6136d78b",
    "attemptId": "00bca969-b53a-4fad-b065-874d41a7b2b8",
    "vendorData": "12345678",
    "endUserId": "a1b2c35d-e8f7-6d5e-3cd2-a1b2c35db3d4",
    "status": "approved",
    "code": 9001,
    "reason": null,
    "reasonCode": null,
    "decisionTime": "2026-02-08T07:17:36.916Z",
    "acceptanceTime": "2026-02-08T07:15:27.000Z",
    "submissionTime": "2026-02-08T07:16:15.736Z"
  }
}
```

### Decision Statuses

| Status | Meaning | Action |
|--------|---------|--------|
| `approved` | Verification passed | Set kycStatus=VERIFIED, maxTradeAmount=10000 |
| `declined` | Verification failed (final) | Set kycStatus=REJECTED |
| `resubmission_requested` | Needs to resubmit | Set kycStatus=ACTION_REQUIRED |
| `expired` | Session expired | Set kycStatus=NOT_STARTED (allow retry) |
| `abandoned` | User left without finishing | Set kycStatus=NOT_STARTED (allow retry) |

### Decision Codes

| Code | Status | Description |
|------|--------|-------------|
| 9001 | approved | Positive: Person was verified |
| 9102 | declined | Negative: Person was not verified (fraud, doc issues) |
| 9103 | resubmission_requested | Resubmission: ask user to retry |
| 9104 | expired | Session expired |

## Webhook Signature Validation

```typescript
import crypto from 'crypto';

function isValidWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const computed = crypto
        .createHmac('sha256', secret)
        .update(Buffer.from(payload, 'utf8'))
        .digest('hex');
    return crypto.timingSafeEqual(
        Buffer.from(computed, 'hex'),
        Buffer.from(signature, 'hex')
    );
}

// In Express handler:
// const signature = req.headers['x-hmac-signature'];
// const isValid = isValidWebhookSignature(rawBody, signature, VERIF_SECRET_KEY);
```

## Frontend: InContext SDK (Embedded Verification)

The InContext SDK embeds Veriff's verification flow inline in your page (like an iframe).

```bash
npm install @veriff/incontext-sdk
```

```typescript
import { createVeriffFrame } from '@veriff/incontext-sdk';

// Modal mode (recommended for Telegram Mini App):
const veriffFrame = createVeriffFrame({
    url: sessionUrl,  // from POST /v1/sessions response
    onEvent: (msg) => {
        switch (msg) {
            case 'STARTED': console.log('User started verification'); break;
            case 'SUBMITTED': console.log('User submitted documents'); break;
            case 'FINISHED': console.log('Verification flow finished'); break;
            case 'CANCELED': console.log('User canceled'); break;
            case 'RELOAD_REQUEST': window.location.reload(); break;
        }
    },
});

// To close the frame:
// veriffFrame.close();
```

## Frontend: JS SDK (Session Creation Form)

Alternative approach — renders a form that creates a session:

```bash
npm install @veriff/js-sdk
```

```typescript
import { Veriff } from '@veriff/js-sdk';

const veriff = Veriff({
    apiKey: 'VERIF_APP_TOKEN',
    parentId: 'veriff-root',
    onSession: (err, response) => {
        if (err) { console.error(err); return; }
        // response.verification.url — use with InContext SDK
        // response.verification.id — session ID
        window.veriffSessionUrl = response.verification.url;
    },
});

veriff.setParams({
    person: { givenName: ' ', lastName: ' ' },  // Hide form fields
    vendorData: String(telegramId),
});

veriff.mount({ submitBtnText: 'Start Verification' });
```

## Recommended Integration Flow for Telegram Mini App

1. **Backend creates session** via `POST /v1/sessions` with user's Telegram ID as `vendorData`
2. **Backend returns** the `verification.url` to the frontend
3. **Frontend uses InContext SDK** to embed the verification flow inline
4. **User completes verification** (uploads ID, selfie)
5. **Veriff sends decision webhook** to backend
6. **Backend updates user's kycStatus** based on decision

This flow is preferred because:
- The API key stays on the backend (secure)
- The frontend only needs the session URL
- InContext SDK provides a smooth embedded experience

## Veriff Dashboard Setup (Human Task)

1. Sign up at veriff.com
2. Create an integration in Veriff Station
3. Get API Key (→ VERIF_APP_TOKEN) and Shared Secret (→ VERIF_SECRET_KEY)
4. Configure webhook URL: `https://domain/api/webhooks/veriff`
5. Enable decision webhooks
6. Configure document requirements: ID document + selfie (face match)
