import { prisma } from '@ibis/shared';
import type { BotContext } from '../types';
import { mainMenuKeyboard } from '../keyboards';

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';

export async function startHandler(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Could not identify user. Please try again.');
    return;
  }

  // Upsert user in DB
  try {
    await prisma.user.upsert({
      where: { telegramId: from.id },
      update: {
        firstName: from.first_name,
        lastName: from.last_name || null,
        username: from.username || null,
      },
      create: {
        telegramId: from.id,
        firstName: from.first_name,
        lastName: from.last_name || null,
        username: from.username || null,
      },
    });
  } catch (err) {
    console.error('Failed to upsert user:', err);
  }

  const welcomeMessage =
    `<b>Welcome to Ibis P2P Exchange!</b>\n\n` +
    `Buy and sell USDT for TTD directly with other users.\n` +
    `Your TON wallet handles everything -- no deposits to us.\n\n` +
    `Use the buttons below to get started:`;

  await ctx.reply(welcomeMessage, {
    parse_mode: 'HTML',
    reply_markup: mainMenuKeyboard(MINI_APP_URL),
  });
}
