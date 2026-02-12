import { prisma } from '@ibis/shared';
import type { BotContext } from '../types';
import { getVerifiedKeyboard } from '../keyboards';

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';

export async function verifyHandler(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Could not identify user.');
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { telegramId: from.id },
      select: { kycStatus: true, kycVerifiedAt: true, maxTradeAmount: true },
    });

    if (!user) {
      await ctx.reply('Please use /start to register first.');
      return;
    }

    if (user.kycStatus === 'VERIFIED') {
      const verifiedDate = user.kycVerifiedAt
        ? ` on ${user.kycVerifiedAt.toLocaleDateString()}`
        : '';
      await ctx.reply(
        `<b>Already Verified</b> ✅\n\n` +
        `Your identity was verified${verifiedDate}.\n` +
        `Trade limit: <b>${user.maxTradeAmount.toFixed(0)} USDT</b> per trade.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (user.kycStatus === 'PENDING') {
      await ctx.reply(
        `<b>Verification Pending</b> ⏳\n\n` +
        `Your documents are being reviewed. This usually takes a few minutes.\n` +
        `We'll notify you when verification is complete.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    let message =
      `<b>Identity Verification (KYC)</b>\n\n` +
      `Get verified to unlock higher trade limits:\n\n` +
      `<b>Without KYC:</b>\n` +
      `• Max 500 USDT per trade\n` +
      `• 1,000 USDT daily limit\n\n` +
      `<b>With KYC:</b>\n` +
      `• Max 10,000 USDT per trade\n` +
      `• 50,000 USDT daily limit\n\n` +
      `<b>What you'll need:</b>\n` +
      `1. A valid government-issued ID\n` +
      `2. A quick selfie for face matching\n` +
      `3. A recent bank statement\n\n` +
      `Tap below to start verification.`;

    if (user.kycStatus === 'ACTION_REQUIRED') {
      message =
        `<b>Action Required</b> ⚠️\n\n` +
        `Your previous verification needs additional information.\n` +
        `Please resubmit your documents to complete verification.\n\n` +
        `Tap below to resubmit.`;
    }

    if (user.kycStatus === 'REJECTED') {
      message =
        `<b>Verification Declined</b> ❌\n\n` +
        `Your previous verification was not successful.\n` +
        `You can try again with valid documents.\n\n` +
        `Tap below to retry.`;
    }

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: getVerifiedKeyboard(MINI_APP_URL),
    });
  } catch (err) {
    console.error('Failed to handle verify command:', err);
    await ctx.reply('Something went wrong. Please try again later.');
  }
}
