import type { BotContext } from '../types';
import { openMiniAppKeyboard } from '../keyboards';

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';

export async function helpHandler(ctx: BotContext): Promise<void> {
  const message =
    `<b>Ibis P2P Exchange - Help</b>\n\n` +
    `Ibis lets you buy and sell USDT for TTD directly with other users ` +
    `using TON blockchain escrow.\n\n` +
    `<b>How it works:</b>\n\n` +
    `<b>Selling USDT:</b>\n` +
    `1. Use /sell to create a sell order\n` +
    `2. Set your amount, price, and payment methods\n` +
    `3. When a buyer accepts, lock USDT in escrow\n` +
    `4. Buyer sends TTD to your bank account\n` +
    `5. Confirm receipt and USDT is released to the buyer\n\n` +
    `<b>Buying USDT:</b>\n` +
    `1. Use /buy to browse available sell orders\n` +
    `2. Accept an order that matches your needs\n` +
    `3. Seller locks USDT in escrow\n` +
    `4. Send TTD to the seller's bank account\n` +
    `5. Seller confirms and USDT is released to you\n\n` +
    `<b>Commands:</b>\n` +
    `/start - Main menu\n` +
    `/sell - Create a sell order\n` +
    `/buy - Browse buy opportunities\n` +
    `/trades - View your active trades\n` +
    `/profile - Your profile and stats\n` +
    `/verify - Start KYC verification\n` +
    `/help - This help message\n\n` +
    `<b>Safety:</b>\n` +
    `- All USDT is held in smart contract escrow\n` +
    `- Disputes are resolved by platform admins\n` +
    `- Get verified (KYC) to increase your trade limits\n\n` +
    `Need help? Open the app for more details.`;

  await ctx.reply(message, {
    parse_mode: 'HTML',
    reply_markup: openMiniAppKeyboard(MINI_APP_URL),
  });
}
