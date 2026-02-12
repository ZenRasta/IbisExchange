import dotenv from 'dotenv';
dotenv.config({ path: '/var/www/ibis/.env' });

import { Bot, session, webhookCallback } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { autoRetry } from '@grammyjs/auto-retry';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { createClient } from 'redis';
import express from 'express';

import type { BotContext, SessionData } from './types';
import { startHandler } from './handlers/start';
import { sellHandler } from './handlers/sell';
import { buyHandler } from './handlers/buy';
import { tradesHandler } from './handlers/trades';
import { profileHandler } from './handlers/profile';
import { helpHandler } from './handlers/help';
import { verifyHandler } from './handlers/verify';
import { registerCallbackHandlers } from './handlers/callbacks';
import { sellFlow } from './conversations/sellConversation';
import { startEventSubscriber } from './services/eventSubscriber';

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const PORT = Number(process.env.PORT) || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

if (!BOT_TOKEN || BOT_TOKEN === 'your_bot_token_here') {
  console.error('BOT_TOKEN is not set in .env. Please set a valid bot token.');
  process.exit(1);
}

// --- Bot Initialization ---
const bot = new Bot<BotContext>(BOT_TOKEN);

// Auto-retry on Telegram rate limits
bot.api.config.use(autoRetry());

// --- Redis for Sessions ---
async function createRedisStorage(): Promise<RedisAdapter<SessionData>> {
  try {
    const client = createClient({ url: REDIS_URL });
    client.on('error', (err) => console.error('Redis session client error:', err));
    await client.connect();
    console.log('Redis session storage connected');
    return new RedisAdapter<SessionData>({ instance: client, ttl: 86400 });
  } catch (err) {
    console.warn('Failed to connect Redis for sessions, using in-memory storage:', err);
    // Fallback to in-memory (grammy default) by returning a Map-based adapter
    // RedisAdapter won't work without connection, so we create a simple adapter
    const store = new Map<string, SessionData>();
    return {
      read: async (key: string) => store.get(key),
      write: async (key: string, value: SessionData) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    } as unknown as RedisAdapter<SessionData>;
  }
}

async function main(): Promise<void> {
  // Create Redis adapter for session storage
  const storage = await createRedisStorage();

  // Session middleware
  bot.use(session({
    initial: (): SessionData => ({
      selectedPaymentMethods: [],
    }),
    storage,
  }));

  // Conversations middleware (must come after session)
  bot.use(conversations());

  // Register conversations
  bot.use(createConversation(sellFlow));

  // --- Command Handlers ---
  bot.command('start', startHandler);
  bot.command('sell', sellHandler);
  bot.command('buy', buyHandler);
  bot.command('trades', tradesHandler);
  bot.command('profile', profileHandler);
  bot.command('verify', verifyHandler);
  bot.command('help', helpHandler);

  // --- Callback Handlers ---
  registerCallbackHandlers(bot);

  // --- Error Handler ---
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Bot error while handling update ${ctx.update.update_id}:`, err.error);
    ctx.reply('An error occurred. Please try again.').catch(() => {});
  });

  // --- Express Webhook Server ---
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ibis-bot' });
  });

  // Webhook endpoint
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  app.use(webhookPath, webhookCallback(bot, 'express'));

  // Start Express server
  app.listen(PORT, async () => {
    console.log(`Bot webhook server listening on port ${PORT}`);
    console.log(`Webhook path: ${webhookPath}`);

    // Set webhook URL with Telegram
    if (WEBHOOK_DOMAIN && WEBHOOK_DOMAIN !== 'https://yourdomain.com') {
      const webhookUrl = `${WEBHOOK_DOMAIN}${webhookPath}`;
      try {
        await bot.api.setWebhook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);
      } catch (err) {
        console.error('Failed to set webhook:', err);
      }
    } else {
      console.warn(
        'WEBHOOK_DOMAIN is not configured. Set it in .env to enable webhook registration.',
      );
    }

    // Start Redis event subscriber for API-originated trade events
    startEventSubscriber(bot).catch((err) =>
      console.warn('Event subscriber failed to start:', err)
    );

    // Set bot commands menu
    try {
      await bot.api.setMyCommands([
        { command: 'start', description: 'Start the bot and show main menu' },
        { command: 'sell', description: 'Create a USDT sell order' },
        { command: 'buy', description: 'Browse available USDT offers' },
        { command: 'trades', description: 'View your active trades' },
        { command: 'profile', description: 'View your profile and stats' },
        { command: 'verify', description: 'Start KYC identity verification' },
        { command: 'help', description: 'How to use Ibis P2P Exchange' },
      ]);
      console.log('Bot commands registered');
    } catch (err) {
      console.error('Failed to register bot commands:', err);
    }

    // Set the menu button to open the Mini App
    const miniAppUrl = process.env.MINI_APP_URL;
    if (miniAppUrl && miniAppUrl !== 'https://yourdomain.com') {
      try {
        await bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: 'Open Exchange',
            web_app: { url: miniAppUrl },
          },
        });
        console.log(`Menu button set to: ${miniAppUrl}`);
      } catch (err) {
        console.error('Failed to set menu button:', err);
      }
    }
  });
}

main().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});

export { bot };
