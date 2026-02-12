import { Bot } from 'grammy';
import { prisma } from '@ibis/shared';
import type { BotContext } from '../types';
import {
  buyerTradeActionsKeyboard,
  buyerEscrowLockedKeyboard,
  sellerPaymentConfirmKeyboard,
  disputeResolutionKeyboard,
} from '../keyboards';

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';

interface TradeWithParties {
  id: string;
  amount: number;
  pricePerUsdt: number;
  fiatAmount: number;
  fiatCurrency: string;
  paymentMethod: string;
  status: string;
  bankDetails: string | null;
  buyer: { telegramId: number | bigint; username: string | null; firstName: string };
  seller: { telegramId: number | bigint; username: string | null; firstName: string };
}

async function getTradeWithParties(tradeId: string): Promise<TradeWithParties | null> {
  return prisma.trade.findUnique({
    where: { id: tradeId },
    include: {
      buyer: { select: { telegramId: true, username: true, firstName: true } },
      seller: { select: { telegramId: true, username: true, firstName: true } },
    },
  });
}

function userMention(user: { username: string | null; firstName: string }): string {
  return user.username ? `@${user.username}` : user.firstName;
}

function tradeRef(tradeId: string): string {
  return `TRD-${tradeId.slice(-6).toUpperCase()}`;
}

async function safeSend(
  bot: Bot<BotContext>,
  chatId: number | bigint,
  text: string,
  options?: Record<string, unknown>,
): Promise<void> {
  try {
    await bot.api.sendMessage(Number(chatId), text, { parse_mode: 'HTML', ...options });
  } catch (err: unknown) {
    const error = err as { description?: string };
    if (error.description?.includes('bot was blocked') || error.description?.includes('chat not found')) {
      console.warn(`Cannot send message to ${chatId}: user blocked bot or chat not found`);
    } else {
      console.error(`Failed to send message to ${chatId}:`, err);
    }
  }
}

/**
 * Notify both parties that a trade has been created (buyer accepted an order)
 */
export async function notifyTradeCreated(
  bot: Bot<BotContext>,
  tradeId: string,
): Promise<void> {
  const trade = await getTradeWithParties(tradeId);
  if (!trade) return;

  const ref = tradeRef(tradeId);
  const amount = trade.amount.toFixed(2);
  const fiat = trade.fiatAmount.toFixed(2);

  // Notify seller
  await safeSend(
    bot,
    trade.seller.telegramId,
    `<b>New Trade ${ref}</b>\n\n` +
    `${userMention(trade.buyer)} wants to buy <b>${amount} USDT</b> ` +
    `at ${trade.pricePerUsdt.toFixed(2)} TTD/USDT.\n` +
    `Total: <b>${fiat} ${trade.fiatCurrency}</b>\n` +
    `Payment: ${trade.paymentMethod}\n\n` +
    `Waiting for buyer to lock USDT in escrow.`,
  );

  // Notify buyer
  await safeSend(
    bot,
    trade.buyer.telegramId,
    `<b>Trade ${ref} Created</b>\n\n` +
    `You are buying <b>${amount} USDT</b> from ${userMention(trade.seller)} ` +
    `at ${trade.pricePerUsdt.toFixed(2)} TTD/USDT.\n` +
    `Total: <b>${fiat} ${trade.fiatCurrency}</b>\n` +
    `Payment: ${trade.paymentMethod}\n\n` +
    `Please lock your USDT in escrow to proceed.`,
    { reply_markup: buyerTradeActionsKeyboard(tradeId, MINI_APP_URL) },
  );
}

/**
 * Notify both parties that escrow has been locked
 */
export async function notifyEscrowLocked(
  bot: Bot<BotContext>,
  tradeId: string,
): Promise<void> {
  const trade = await getTradeWithParties(tradeId);
  if (!trade) return;

  const ref = tradeRef(tradeId);
  const fiat = trade.fiatAmount.toFixed(2);

  // Notify seller
  await safeSend(
    bot,
    trade.seller.telegramId,
    `<b>Escrow Locked - ${ref}</b>\n\n` +
    `${userMention(trade.buyer)} has locked <b>${trade.amount.toFixed(2)} USDT</b> in escrow.\n` +
    `Waiting for buyer to send <b>${fiat} ${trade.fiatCurrency}</b> via ${trade.paymentMethod}.` +
    (trade.bankDetails ? `\n\nBank details: <code>${trade.bankDetails}</code>` : ''),
  );

  // Notify buyer
  await safeSend(
    bot,
    trade.buyer.telegramId,
    `<b>Escrow Locked - ${ref}</b>\n\n` +
    `Your USDT is safely in escrow.\n` +
    `Please send <b>${fiat} ${trade.fiatCurrency}</b> to the seller via ${trade.paymentMethod}.` +
    (trade.bankDetails ? `\n\nBank details: <code>${trade.bankDetails}</code>` : '') +
    `\n\nOnce you've sent the payment, tap the button below.`,
    { reply_markup: buyerEscrowLockedKeyboard(tradeId) },
  );
}

/**
 * Notify seller that buyer claims to have sent fiat
 */
export async function notifyFiatSent(
  bot: Bot<BotContext>,
  tradeId: string,
): Promise<void> {
  const trade = await getTradeWithParties(tradeId);
  if (!trade) return;

  const ref = tradeRef(tradeId);
  const fiat = trade.fiatAmount.toFixed(2);

  // Notify seller with confirmation buttons
  await safeSend(
    bot,
    trade.seller.telegramId,
    `<b>Payment Sent - ${ref}</b>\n\n` +
    `${userMention(trade.buyer)} has sent <b>${fiat} ${trade.fiatCurrency}</b> ` +
    `via ${trade.paymentMethod}.\n\n` +
    `Please check your account and confirm receipt.`,
    { reply_markup: sellerPaymentConfirmKeyboard(tradeId) },
  );

  // Notify buyer
  await safeSend(
    bot,
    trade.buyer.telegramId,
    `<b>Payment Sent - ${ref}</b>\n\n` +
    `You marked the payment as sent. Waiting for ${userMention(trade.seller)} to confirm receipt.\n\n` +
    `If the seller doesn't respond within 6 hours, you may open a dispute.`,
  );
}

/**
 * Notify both parties that fiat payment was confirmed
 */
export async function notifyFiatConfirmed(
  bot: Bot<BotContext>,
  tradeId: string,
): Promise<void> {
  const trade = await getTradeWithParties(tradeId);
  if (!trade) return;

  const ref = tradeRef(tradeId);

  const msg =
    `<b>Payment Confirmed - ${ref}</b>\n\n` +
    `Seller confirmed receipt of payment. Releasing USDT from escrow...`;

  await safeSend(bot, trade.buyer.telegramId, msg);
  await safeSend(bot, trade.seller.telegramId, msg);
}

/**
 * Notify both parties that trade completed and USDT released
 */
export async function notifyTradeCompleted(
  bot: Bot<BotContext>,
  tradeId: string,
): Promise<void> {
  const trade = await getTradeWithParties(tradeId);
  if (!trade) return;

  const ref = tradeRef(tradeId);

  const msg =
    `<b>Trade Completed - ${ref}</b>\n\n` +
    `<b>${trade.amount.toFixed(2)} USDT</b> has been released to ${userMention(trade.buyer)}.\n` +
    `Thank you for using Ibis P2P Exchange!`;

  await safeSend(bot, trade.buyer.telegramId, msg);
  await safeSend(bot, trade.seller.telegramId, msg);
}

/**
 * Notify both parties and admin about a dispute
 */
export async function notifyDispute(
  bot: Bot<BotContext>,
  tradeId: string,
  openedBy: string,
): Promise<void> {
  const trade = await getTradeWithParties(tradeId);
  if (!trade) return;

  const ref = tradeRef(tradeId);
  const opener = openedBy === trade.buyer.telegramId.toString()
    ? userMention(trade.buyer)
    : userMention(trade.seller);

  const msg =
    `<b>Dispute Opened - ${ref}</b>\n\n` +
    `${opener} has opened a dispute on this trade.\n` +
    `Amount: <b>${trade.amount.toFixed(2)} USDT</b> (${trade.fiatAmount.toFixed(2)} ${trade.fiatCurrency})\n\n` +
    `An admin will review and resolve this dispute.`;

  await safeSend(bot, trade.buyer.telegramId, msg);
  await safeSend(bot, trade.seller.telegramId, msg);

  // Admin notification - for now log; in production this would go to an admin chat
  console.log(`[DISPUTE] Trade ${ref} disputed by ${opener}`);

  // If there's an admin chat ID set, notify them
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (adminChatId) {
    await safeSend(
      bot,
      Number(adminChatId),
      `<b>DISPUTE - ${ref}</b>\n\n` +
      `Opened by: ${opener}\n` +
      `Buyer: ${userMention(trade.buyer)} (${trade.buyer.telegramId})\n` +
      `Seller: ${userMention(trade.seller)} (${trade.seller.telegramId})\n` +
      `Amount: ${trade.amount.toFixed(2)} USDT\n` +
      `Fiat: ${trade.fiatAmount.toFixed(2)} ${trade.fiatCurrency}\n` +
      `Payment: ${trade.paymentMethod}\n` +
      `Status: ${trade.status}`,
      { reply_markup: disputeResolutionKeyboard(tradeId) },
    );
  }
}

/**
 * Notify both parties that dispute has been resolved
 */
export async function notifyDisputeResolved(
  bot: Bot<BotContext>,
  tradeId: string,
  winner: string,
): Promise<void> {
  const trade = await getTradeWithParties(tradeId);
  if (!trade) return;

  const ref = tradeRef(tradeId);
  const resolution = winner === 'buyer'
    ? `USDT has been released to ${userMention(trade.buyer)}.`
    : `USDT has been refunded to ${userMention(trade.seller)}.`;

  const msg =
    `<b>Dispute Resolved - ${ref}</b>\n\n` +
    `${resolution}\n\n` +
    `If you have further concerns, please contact support.`;

  await safeSend(bot, trade.buyer.telegramId, msg);
  await safeSend(bot, trade.seller.telegramId, msg);
}

/**
 * Notify that escrow has timed out
 */
export async function notifyEscrowTimeout(
  bot: Bot<BotContext>,
  tradeId: string,
): Promise<void> {
  const trade = await getTradeWithParties(tradeId);
  if (!trade) return;

  const ref = tradeRef(tradeId);

  const msg =
    `<b>Trade Expired - ${ref}</b>\n\n` +
    `The escrow funding window has expired. This trade has been cancelled.`;

  await safeSend(bot, trade.buyer.telegramId, msg);
  await safeSend(bot, trade.seller.telegramId, msg);
}
