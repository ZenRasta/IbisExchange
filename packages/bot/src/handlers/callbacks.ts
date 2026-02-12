import { Bot } from 'grammy';
import { prisma, redis } from '@ibis/shared';
import type { BotContext } from '../types';
import {
  notifyTradeCreated,
  notifyFiatSent,
  notifyFiatConfirmed,
  notifyDispute,
  notifyDisputeResolved,
} from '../services/notifier';

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';
const FIAT_SENT_TIMEOUT_SECONDS = 6 * 60 * 60; // 6 hours

function tradeRef(tradeId: string): string {
  return `TRD-${tradeId.slice(-6).toUpperCase()}`;
}

/**
 * Register all callback query handlers on the bot
 */
export function registerCallbackHandlers(bot: Bot<BotContext>): void {
  // Command shortcuts from inline keyboard
  bot.callbackQuery('cmd:sell', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.enter('sellFlow');
    } catch {
      await ctx.reply('Use /sell to create a sell order.');
    }
  });

  bot.callbackQuery('cmd:buy', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { buyHandler } = await import('./buy');
    await buyHandler(ctx);
  });

  bot.callbackQuery('cmd:trades', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { tradesHandler } = await import('./trades');
    await tradesHandler(ctx);
  });

  bot.callbackQuery('cmd:profile', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { profileHandler } = await import('./profile');
    await profileHandler(ctx);
  });

  bot.callbackQuery('cmd:verify', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { verifyHandler } = await import('./verify');
    await verifyHandler(ctx);
  });

  // Accept an order (buyer accepts a sell order)
  bot.callbackQuery(/^accept_order:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderId = ctx.match[1];

    try {
      const from = ctx.from;
      if (!from) return;

      // Get the buyer user
      const buyer = await prisma.user.findUnique({
        where: { telegramId: from.id },
      });

      if (!buyer) {
        await ctx.reply('Please use /start to register first.');
        return;
      }

      // Get the order with seller info
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { user: true },
      });

      if (!order) {
        await ctx.reply('This order no longer exists.');
        return;
      }

      if (order.status !== 'ACTIVE') {
        await ctx.reply('This order is no longer active.');
        return;
      }

      // Check buyer is not the seller
      if (order.userId === buyer.id) {
        await ctx.reply('You cannot accept your own order.');
        return;
      }

      // Check buyer wallet
      if (!buyer.tonAddress) {
        await ctx.reply(
          'You need to connect your TON wallet first.\nOpen the app and tap the wallet button in the top-right corner.',
          {
            reply_markup: {
              inline_keyboard: [[{
                text: 'Open App to Connect Wallet',
                web_app: { url: `${MINI_APP_URL}` },
              }]],
            },
          },
        );
        return;
      }

      // Check trade limits
      const tradeAmount = order.remainingAmount;
      if (tradeAmount > buyer.maxTradeAmount) {
        await ctx.reply(
          `This order exceeds your trade limit of ${buyer.maxTradeAmount} USDT.\n` +
          (buyer.kycStatus !== 'VERIFIED'
            ? 'Get verified to increase your limit!'
            : ''),
        );
        return;
      }

      // Calculate fiat amount
      const fiatAmount = tradeAmount * order.pricePerUsdt;

      // Create the trade
      const trade = await prisma.trade.create({
        data: {
          orderId: order.id,
          buyerId: buyer.id,
          sellerId: order.userId,
          amount: tradeAmount,
          pricePerUsdt: order.pricePerUsdt,
          fiatAmount,
          fiatCurrency: 'TTD',
          paymentMethod: order.paymentMethods[0] || 'Bank Transfer',
          bankDetails: order.bankDetails,
          status: 'AWAITING_ESCROW',
        },
      });

      // Update order status
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'MATCHED',
          remainingAmount: 0,
        },
      });

      // Notify both parties
      await notifyTradeCreated(bot, trade.id);

      // Set escrow funding timeout in Redis (30 minutes)
      try {
        await redis.set(
          `escrow_timeout:${trade.id}`,
          Date.now().toString(),
          { EX: 1800 },
        );
      } catch (redisErr) {
        console.warn('Failed to set escrow timeout in Redis:', redisErr);
      }
    } catch (err) {
      console.error('Failed to accept order:', err);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  // Buyer marks fiat payment as sent
  bot.callbackQuery(/^payment_sent:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tradeId = ctx.match[1];

    try {
      const from = ctx.from;
      if (!from) return;

      const user = await prisma.user.findUnique({
        where: { telegramId: from.id },
      });

      if (!user) {
        await ctx.reply('Please use /start to register first.');
        return;
      }

      const trade = await prisma.trade.findUnique({
        where: { id: tradeId },
      });

      if (!trade) {
        await ctx.reply('Trade not found.');
        return;
      }

      // Only buyer can mark payment as sent
      if (trade.buyerId !== user.id) {
        await ctx.reply('Only the buyer can mark payment as sent.');
        return;
      }

      // Must be in ESCROW_LOCKED status
      if (trade.status !== 'ESCROW_LOCKED') {
        await ctx.reply(
          `Cannot mark payment as sent. Current status: ${trade.status}.\n` +
          `Escrow must be locked first.`,
        );
        return;
      }

      // Update trade status
      await prisma.trade.update({
        where: { id: tradeId },
        data: {
          status: 'FIAT_SENT',
          fiatSentAt: new Date(),
        },
      });

      // Set 6-hour timeout for seller response
      try {
        await redis.set(
          `fiat_sent_timeout:${tradeId}`,
          Date.now().toString(),
          { EX: FIAT_SENT_TIMEOUT_SECONDS },
        );
      } catch (redisErr) {
        console.warn('Failed to set fiat sent timeout in Redis:', redisErr);
      }

      // Notify both parties
      await notifyFiatSent(bot, tradeId);
    } catch (err) {
      console.error('Failed to mark payment sent:', err);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  // Seller confirms fiat payment received
  bot.callbackQuery(/^confirm_payment:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tradeId = ctx.match[1];

    try {
      const from = ctx.from;
      if (!from) return;

      const user = await prisma.user.findUnique({
        where: { telegramId: from.id },
      });

      if (!user) {
        await ctx.reply('Please use /start to register first.');
        return;
      }

      const trade = await prisma.trade.findUnique({
        where: { id: tradeId },
      });

      if (!trade) {
        await ctx.reply('Trade not found.');
        return;
      }

      // Only seller can confirm payment
      if (trade.sellerId !== user.id) {
        await ctx.reply('Only the seller can confirm payment receipt.');
        return;
      }

      // Must be in FIAT_SENT status
      if (trade.status !== 'FIAT_SENT') {
        await ctx.reply(
          `Cannot confirm payment. Current status: ${trade.status}.\n` +
          `Buyer must mark payment as sent first.`,
        );
        return;
      }

      // Update trade status to RELEASING (escrow release will be triggered by API)
      await prisma.trade.update({
        where: { id: tradeId },
        data: {
          status: 'RELEASING',
        },
      });

      // Notify both
      await notifyFiatConfirmed(bot, tradeId);

      // Clear the fiat sent timeout
      try {
        await redis.del(`fiat_sent_timeout:${tradeId}`);
      } catch (redisErr) {
        console.warn('Failed to clear fiat sent timeout:', redisErr);
      }

      // TODO: The API service will handle actual escrow release via smart contract
      // For now, we move to RELEASING status. The API agent's endpoint will
      // update to COMPLETED and call notifyTradeCompleted.
    } catch (err) {
      console.error('Failed to confirm payment:', err);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  // Either party opens a dispute
  bot.callbackQuery(/^dispute:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tradeId = ctx.match[1];

    try {
      const from = ctx.from;
      if (!from) return;

      const user = await prisma.user.findUnique({
        where: { telegramId: from.id },
      });

      if (!user) {
        await ctx.reply('Please use /start to register first.');
        return;
      }

      const trade = await prisma.trade.findUnique({
        where: { id: tradeId },
      });

      if (!trade) {
        await ctx.reply('Trade not found.');
        return;
      }

      // Only trade participants can dispute
      if (trade.buyerId !== user.id && trade.sellerId !== user.id) {
        await ctx.reply('You are not a participant in this trade.');
        return;
      }

      // Can only dispute active trades
      const disputableStatuses = ['ESCROW_LOCKED', 'FIAT_SENT', 'RELEASING'];
      if (!disputableStatuses.includes(trade.status)) {
        await ctx.reply(`Cannot open dispute. Current status: ${trade.status}.`);
        return;
      }

      // Update to DISPUTED
      await prisma.trade.update({
        where: { id: tradeId },
        data: {
          status: 'DISPUTED',
          disputedAt: new Date(),
          disputeReason: `Dispute opened by user ${from.id}`,
        },
      });

      // Notify all parties
      await notifyDispute(bot, tradeId, from.id.toString());
    } catch (err) {
      console.error('Failed to open dispute:', err);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  // Admin resolves dispute
  bot.callbackQuery(/^resolve_dispute:(.+):(buyer|seller)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tradeId = ctx.match[1];
    const winner = ctx.match[2];

    try {
      const trade = await prisma.trade.findUnique({
        where: { id: tradeId },
      });

      if (!trade) {
        await ctx.reply('Trade not found.');
        return;
      }

      if (trade.status !== 'DISPUTED') {
        await ctx.reply('This trade is not in dispute.');
        return;
      }

      // Update trade status based on resolution
      const newStatus = winner === 'buyer' ? 'RESOLVED_RELEASE' : 'RESOLVED_REFUND';
      const resolution = winner === 'buyer'
        ? 'USDT released to buyer'
        : 'USDT refunded to seller';

      await prisma.trade.update({
        where: { id: tradeId },
        data: {
          status: newStatus as 'RESOLVED_RELEASE' | 'RESOLVED_REFUND',
          disputeResolution: resolution,
          completedAt: new Date(),
        },
      });

      // Notify all parties
      await notifyDisputeResolved(bot, tradeId, winner);

      await ctx.editMessageText(
        `Dispute resolved: ${resolution} for trade ${tradeRef(tradeId)}.`,
      );
    } catch (err) {
      console.error('Failed to resolve dispute:', err);
      await ctx.reply('Something went wrong resolving the dispute.');
    }
  });

  // Cancel trade (before escrow is locked)
  bot.callbackQuery(/^cancel_trade:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tradeId = ctx.match[1];

    try {
      const from = ctx.from;
      if (!from) return;

      const user = await prisma.user.findUnique({
        where: { telegramId: from.id },
      });

      if (!user) return;

      const trade = await prisma.trade.findUnique({
        where: { id: tradeId },
        include: { order: true },
      });

      if (!trade) {
        await ctx.reply('Trade not found.');
        return;
      }

      // Only allow cancellation before escrow is locked
      if (trade.status !== 'AWAITING_ESCROW') {
        await ctx.reply('Cannot cancel trade after escrow has been locked.');
        return;
      }

      // Only the buyer can cancel at this stage
      if (trade.buyerId !== user.id) {
        await ctx.reply('Only the buyer can cancel at this stage.');
        return;
      }

      // Cancel the trade
      await prisma.trade.update({
        where: { id: tradeId },
        data: { status: 'CANCELLED' },
      });

      // Restore the order
      await prisma.order.update({
        where: { id: trade.orderId },
        data: {
          status: 'ACTIVE',
          remainingAmount: trade.order.amount,
        },
      });

      await ctx.reply(`Trade ${tradeRef(tradeId)} has been cancelled.`);
    } catch (err) {
      console.error('Failed to cancel trade:', err);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });
}
