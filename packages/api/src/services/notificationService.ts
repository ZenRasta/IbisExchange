import { redis, connectRedis } from '@ibis/shared';

/**
 * Bridge between the API server and the Telegram bot.
 * Publishes events to a Redis pub/sub channel that the bot listens on.
 */

export interface TradeEvent {
    type:
        | 'TRADE_CREATED'
        | 'ESCROW_LOCKED'
        | 'FIAT_SENT'
        | 'FIAT_CONFIRMED'
        | 'TRADE_COMPLETED'
        | 'TRADE_DISPUTED'
        | 'TRADE_RESOLVED'
        | 'TRADE_CANCELLED'
        | 'ESCROW_TIMEOUT'
        | 'FIAT_TIMEOUT';
    tradeId: string;
    buyerTelegramId: number | bigint;
    sellerTelegramId: number | bigint;
    amount: number;
    fiatAmount: number;
    paymentMethod?: string;
    bankDetails?: string;
    extra?: Record<string, unknown>;
}

const CHANNEL = 'trade-events';

export class NotificationService {
    /**
     * Publish a trade event to the Redis channel.
     * The bot subscribes to this channel and sends appropriate Telegram messages.
     */
    async publishTradeEvent(event: TradeEvent): Promise<void> {
        try {
            await connectRedis();
            await redis.publish(CHANNEL, JSON.stringify(event));
        } catch (err) {
            console.error('Failed to publish trade event:', err);
        }
    }

    /**
     * Notify admin(s) about a dispute or important event.
     */
    async notifyAdmins(message: string, data?: Record<string, unknown>): Promise<void> {
        try {
            await connectRedis();
            const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '')
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean)
                .map(Number);

            for (const adminId of adminIds) {
                await redis.publish(
                    CHANNEL,
                    JSON.stringify({
                        type: 'ADMIN_NOTIFICATION',
                        targetTelegramId: adminId,
                        message,
                        ...data,
                    })
                );
            }
        } catch (err) {
            console.error('Failed to notify admins:', err);
        }
    }
}

export const notificationService = new NotificationService();
