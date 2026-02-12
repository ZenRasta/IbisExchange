import { prisma } from '@ibis/shared';
import type { BotContext } from '../types';
import { getVerifiedKeyboard } from '../keyboards';

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';

function kycStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    NOT_STARTED: 'Not Verified',
    PENDING: 'Verification Pending',
    ACTION_REQUIRED: 'Action Required',
    VERIFIED: 'Verified',
    REJECTED: 'Verification Rejected',
  };
  return labels[status] || status;
}

export async function profileHandler(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Could not identify user.');
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { telegramId: from.id },
    });

    if (!user) {
      await ctx.reply('Please use /start to register first.');
      return;
    }

    const kycLabel = kycStatusLabel(user.kycStatus);
    const walletStatus = user.tonAddress
      ? `<code>${user.tonAddress.slice(0, 8)}...${user.tonAddress.slice(-6)}</code>`
      : 'Not connected';

    let message =
      `<b>Your Profile</b>\n\n` +
      `Name: ${user.firstName}${user.lastName ? ' ' + user.lastName : ''}\n` +
      `Username: ${user.username ? '@' + user.username : 'Not set'}\n` +
      `Wallet: ${walletStatus}\n\n` +
      `<b>KYC Status:</b> ${kycLabel}\n` +
      `<b>Trade Limit:</b> ${user.maxTradeAmount.toFixed(0)} USDT per trade\n\n` +
      `<b>Statistics:</b>\n` +
      `Total Trades: ${user.totalTrades}\n` +
      `Successful: ${user.successfulTrades}\n` +
      `Volume: ${user.totalVolume.toFixed(2)} USDT\n` +
      `Reputation: ${user.reputationScore.toFixed(1)}/5.0\n`;

    if (user.kycStatus !== 'VERIFIED') {
      message += '\nGet verified to increase your trade limit to 10,000 USDT!';

      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: getVerifiedKeyboard(MINI_APP_URL),
      });
    } else {
      await ctx.reply(message, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('Failed to fetch profile:', err);
    await ctx.reply('Something went wrong. Please try again later.');
  }
}
