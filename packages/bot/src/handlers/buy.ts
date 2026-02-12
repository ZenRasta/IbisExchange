import { prisma } from '@ibis/shared';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { acceptOrderKeyboard, viewMoreKeyboard } from '../keyboards';

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';

export async function buyHandler(ctx: BotContext): Promise<void> {
  try {
    // Query top 5 active sell orders, ordered by price (lowest first)
    const orders = await prisma.order.findMany({
      where: {
        type: 'SELL',
        status: 'ACTIVE',
        remainingAmount: { gt: 0 },
      },
      include: {
        user: {
          select: {
            username: true,
            firstName: true,
            kycStatus: true,
            reputationScore: true,
            totalTrades: true,
          },
        },
      },
      orderBy: { pricePerUsdt: 'asc' },
      take: 5,
    });

    if (orders.length === 0) {
      await ctx.reply(
        '<b>No sell orders available right now.</b>\n\n' +
        'Check back later or open the app to set up a buy order alert.',
        {
          parse_mode: 'HTML',
          reply_markup: viewMoreKeyboard(MINI_APP_URL),
        },
      );
      return;
    }

    let message = '<b>Available USDT for sale:</b>\n\n';

    const kb = new InlineKeyboard();

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const user = order.user;
      const displayName = user.username ? `@${user.username}` : user.firstName;
      const verified = user.kycStatus === 'VERIFIED' ? ' [Verified]' : '';
      const reputation = user.totalTrades > 0
        ? `${user.reputationScore.toFixed(1)} (${user.totalTrades} trades)`
        : 'New seller';
      const banks = order.paymentMethods.join(', ');

      message +=
        `${i + 1}. ${displayName} -- <b>${order.remainingAmount.toFixed(2)} USDT</b> @ ${order.pricePerUsdt.toFixed(2)} TTD\n` +
        `   Payment: ${banks}\n` +
        `   Rating: ${reputation}${verified}\n\n`;

      kb.text(`Accept #${i + 1}`, `accept_order:${order.id}`).row();
    }

    kb.webApp('View More in App', `${MINI_APP_URL}/orders`);

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  } catch (err) {
    console.error('Failed to fetch orders:', err);
    await ctx.reply('Something went wrong fetching orders. Please try again later.');
  }
}
