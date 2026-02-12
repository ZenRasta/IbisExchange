import dotenv from 'dotenv';
// Load environment variables from the project root .env
dotenv.config({ path: '/var/www/ibis/.env' });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { connectRedis } from '@ibis/shared';

// Middleware
import { telegramAuth } from './middleware/telegramAuth';
import { rateLimiter } from './middleware/rateLimiter';

// Routes — owned by this agent
import { ordersRouter } from './routes/orders';
import { tradesRouter } from './routes/trades';
import { usersRouter } from './routes/users';
import { webhooksRouter } from './routes/webhooks';

// Routes — owned by KYC agent (DO NOT MODIFY)
import { kycRouter } from './routes/kyc';
import { kycWebhookRouter } from './routes/kycWebhook';

// Services
import { tonMonitor } from './services/tonMonitor';
import { matchingEngine } from './services/matchingEngine';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// --------------- Global Middleware ---------------
app.use(helmet({
    // Disable Helmet's default CSP — nginx sets the correct CSP for the mini-app.
    // Helmet's restrictive default (script-src 'self', etc.) causes duplicate/conflicting
    // headers when API responses are proxied through nginx.
    contentSecurityPolicy: false,
    // Disable X-Frame-Options — nginx sets frame-ancestors via CSP instead.
    frameguard: false,
}));
app.use(compression());
app.use(
    cors({
        origin: process.env.MINI_APP_URL || '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
    })
);

// Mount KYC webhook BEFORE express.json() — it uses express.raw() to read the raw body
// for HMAC signature verification. express.json() would consume the body first.
app.use('/api/webhooks', kycWebhookRouter);

// Parse JSON for all other routes
app.use(express.json());

// --------------- Health Check ---------------
app.get('/api/health', (_req, res) => {
    res.json({
        success: true,
        data: {
            status: 'ok',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
        },
    });
});

// --------------- Webhook Routes (NO auth — they have their own verification) ---------------
app.use('/api/webhooks', webhooksRouter);

// --------------- Authenticated Routes (Telegram initData required) ---------------
app.use('/api/orders', telegramAuth, rateLimiter({ windowMs: 60000, max: 30, keyPrefix: 'rl:orders' }), ordersRouter);
app.use('/api/trades', telegramAuth, rateLimiter({ windowMs: 60000, max: 20, keyPrefix: 'rl:trades' }), tradesRouter);
app.use('/api/users', telegramAuth, rateLimiter({ windowMs: 60000, max: 30, keyPrefix: 'rl:users' }), usersRouter);
app.use('/api/kyc', telegramAuth, kycRouter);

// --------------- 404 Handler ---------------
app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
});

// --------------- Error Handler ---------------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

// --------------- Start Server ---------------
async function start() {
    try {
        // Connect to Redis
        await connectRedis();
        console.log('Connected to Redis');
    } catch (err) {
        console.warn('Redis connection failed (non-fatal):', err);
    }

    // Start TON Monitor polling
    tonMonitor.startPolling();

    // Start stale order expiry (every 5 minutes)
    setInterval(async () => {
        try {
            await matchingEngine.expireStaleOrders();
        } catch (err) {
            console.error('Order expiry error:', err);
        }
    }, 5 * 60 * 1000);

    app.listen(PORT, () => {
        console.log(`Ibis API server listening on port ${PORT}`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
}

start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

export default app;
