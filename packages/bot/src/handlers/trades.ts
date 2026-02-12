import { InlineKeyboard } from 'grammy';
import { prisma } from '@ibis/shared';
import { TradeStatus } from '@prisma/client';
import type { BotContext } from '../types';

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';

function tradeRef(tradeId: string): string {
  return `TRD-${tradeId.slice(-6).toUpperCase()}`;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    AWAITING_ESCROW: 'Awaiting Escrow',
    ESCROW_LOCKED: 'Escrow Locked',
    FIAT_SENT: 'Fiat Sent',
    RELEASING: 'Releasing',
    COMPLETED: 'Completed',
    REFUNDED: 'Refunded',
    DISPUTED: 'Disputed',
    RESOLVED_RELEASE: 'Resolved (Released)',
    RESOLVED_REFUND: 'Resolved (Refunded)',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
  };
  return labels[status] || status;
}

export async function tradesHandler(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Could not identify user.');
    return;
  }

  try {
    // Find the user
    const user = await prisma.user.findUnique({
      where: { telegramId: from.id },
    });

    if (!user) {
      await ctx.reply('Please use /start to register first.');
      return;
    }

    // Fetch active trades (non-terminal statuses)
    const activeStatuses: TradeStatus[] = [
      'AWAITING_ESCROW',
      'ESCROW_LOCKED',
      'FIAT_SENT',
      'RELEASING',
      'DISPUTED',
    ];

    const trades = await prisma.trade.findMany({
      where: {
        OR: [
          { buyerId: user.id },
          { sellerId: user.id },
        ],
        status: { in: activeStatuses },
      },
      include: {
        buyer: { select: { username: true, firstName: true, telegramId: true } },
        seller: { select: { username: true, firstName: true, telegramId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (trades.length === 0) {
      await ctx.reply(
        '<b>No active trades.</b>\n\n' +
        'Use /buy to browse available offers or /sell to create one.',
        { parse_mode: 'HTML' },
      );
      return;
    }

    let message = '<b>Your Active Trades:</b>\n\n';

    for (const trade of trades) {
      const isBuyer = trade.buyerId === user.id;
      const role = isBuyer ? 'Buying' : 'Selling';
      const seller = (trade as any).seller;
      const buyer = (trade as any).buyer;
      const counterparty = isBuyer
        ? (seller?.username ? `@${seller.username}` : seller?.firstName)
        : (buyer?.username ? `@${buyer.username}` : buyer?.firstName);

      message +=
        `<b>${tradeRef(trade.id)}</b> - ${statusLabel(trade.status)}\n` +
        `${role} <b>${trade.amount.toFixed(2)} USDT</b> @ ${trade.pricePerUsdt.toFixed(2)} TTD\n` +
        `Fiat: ${trade.fiatAmount.toFixed(2)} ${trade.fiatCurrency}\n` +
        `With: ${counterparty}\n\n`;
    }

    message += 'Tap below to view all trades in the app.';

    const kb = new InlineKeyboard()
      .webApp('View All Trades', `${MINI_APP_URL}/trades`);

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  } catch (err) {
    console.error('Failed to fetch trades:', err);
    await ctx.reply('Something went wrong. Please try again later.');
  }
}
