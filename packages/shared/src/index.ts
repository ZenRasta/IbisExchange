// Enable BigInt JSON serialization (Prisma BigInt fields return JS bigint)
// Telegram IDs exceed 32-bit int range but fit safely in JS number (max 2^53)
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

export { default as prisma } from './db';
export { default as redis, connectRedis } from './redis';
export * from './constants';
export * from './types';
