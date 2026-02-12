import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (err) => console.error('Redis error:', err));
export default redis;
export async function connectRedis() { if (!redis.isOpen) await redis.connect(); return redis; }
