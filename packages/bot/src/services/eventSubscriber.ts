import { Bot } from 'grammy';
import { createClient } from 'redis';
import type { BotContext } from '../types';
import {
  notifyTradeCreated,
  notifyEscrowLocked,
  notifyFiatSent,
  notifyFiatConfirmed,
  notifyTradeCompleted,
  notifyDispute,
  notifyDisputeResolved,
  notifyEscrowTimeout,
} from './notifier';

const CHANNEL = 'trade-events';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

interface TradeEvent {
  type: string;
  tradeId: string;
  buyerTelegramId?: number;
  sellerTelegramId?: number;
  extra?: Record<string, unknown>;
}

/**
 * Subscribe to trade events published by the API via Redis pub/sub.
 * Routes each event type to the appropriate notification function.
 */
export async function startEventSubscriber(bot: Bot<BotContext>): Promise<void> {
  try {
    const subscriber = createClient({ url: REDIS_URL });
    subscriber.on('error', (err) => console.error('Redis subscriber error:', err));
    await subscriber.connect();

    await subscriber.subscribe(CHANNEL, async (message) => {
      try {
        const event: TradeEvent = JSON.parse(message);
        console.log(`[EventSubscriber] Received: ${event.type} for trade ${event.tradeId}`);

        switch (event.type) {
          case 'TRADE_CREATED':
            await notifyTradeCreated(bot, event.tradeId);
            break;
          case 'ESCROW_LOCKED':
            await notifyEscrowLocked(bot, event.tradeId);
            break;
          case 'FIAT_SENT':
            await notifyFiatSent(bot, event.tradeId);
            break;
          case 'FIAT_CONFIRMED':
            await notifyFiatConfirmed(bot, event.tradeId);
            break;
          case 'TRADE_COMPLETED':
            await notifyTradeCompleted(bot, event.tradeId);
            break;
          case 'TRADE_DISPUTED':
            await notifyDispute(bot, event.tradeId, String(event.extra?.openedBy || ''));
            break;
          case 'TRADE_RESOLVED':
            await notifyDisputeResolved(bot, event.tradeId, String(event.extra?.winner || ''));
            break;
          case 'ESCROW_TIMEOUT':
          case 'TRADE_CANCELLED':
            await notifyEscrowTimeout(bot, event.tradeId);
            break;
          default:
            console.log(`[EventSubscriber] Unknown event type: ${event.type}`);
        }
      } catch (err) {
        console.error('[EventSubscriber] Failed to process event:', err);
      }
    });

    console.log(`[EventSubscriber] Subscribed to Redis channel: ${CHANNEL}`);
  } catch (err) {
    console.warn('[EventSubscriber] Failed to connect to Redis for events:', err);
  }
}
