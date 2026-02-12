import { Request, Response, NextFunction } from 'express';
import { redis, connectRedis } from '@ibis/shared';

interface RateLimiterOpts {
    /** Time window in milliseconds */
    windowMs: number;
    /** Max requests per window */
    max: number;
    /** Redis key prefix */
    keyPrefix: string;
}

/**
 * Redis-based sliding window rate limiter.
 * Uses a simple counter with TTL.
 */
export function rateLimiter(opts: RateLimiterOpts) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await connectRedis();

            const identifier = req.telegramUser?.id || req.ip || 'unknown';
            const key = `${opts.keyPrefix}:${identifier}`;
            const windowSec = Math.ceil(opts.windowMs / 1000);

            const current = await redis.incr(key);

            // Set TTL on first request in window
            if (current === 1) {
                await redis.expire(key, windowSec);
            }

            // Set rate limit headers
            const ttl = await redis.ttl(key);
            res.setHeader('X-RateLimit-Limit', opts.max);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, opts.max - current));
            res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + ttl);

            if (current > opts.max) {
                res.setHeader('Retry-After', ttl);
                res.status(429).json({
                    success: false,
                    error: 'Too many requests. Please try again later.',
                    code: 'RATE_LIMITED',
                });
                return;
            }

            next();
        } catch (err) {
            // If Redis is unavailable, allow the request through
            console.error('Rate limiter error:', err);
            next();
        }
    };
}
