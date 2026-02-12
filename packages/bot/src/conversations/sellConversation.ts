import type { Conversation } from '@grammyjs/conversations';
import {
  prisma,
  MIN_TRADE_USDT,
  MAX_TRADE_USDT_UNVERIFIED,
  MAX_TRADE_USDT_VERIFIED,
  SUPPORTED_PAYMENT_METHODS,
} from '@ibis/shared';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { confirmCancelKeyboard } from '../keyboards';

type SellConversation = Conversation<BotContext, BotContext>;

/**
 * Build the payment method selection keyboard for the conversation.
 * Selected methods have a checkmark prefix.
 */
function buildPaymentMethodKeyboard(selected: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  const methods = SUPPORTED_PAYMENT_METHODS as readonly string[];

  for (let i = 0; i < methods.length; i++) {
    const method = methods[i];
    const isSelected = selected.includes(method);
    const label = isSelected ? `[x] ${method}` : method;
    kb.text(label, `pm_select:${i}`);
    if (i % 2 === 1) kb.row();
  }

  if (methods.length % 2 === 1) kb.row();
  kb.text('Done', 'pm_done');

  return kb;
}

/**
 * Multi-step sell flow conversation.
 *
 * Steps:
 * 1. Amount of USDT to sell
 * 2. Price per USDT in TTD
 * 3. Payment methods (multi-select)
 * 4. Bank details
 * 5. Confirmation
 */
export async function sellFlow(conversation: SellConversation, ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Could not identify user. Please try /sell again.');
    return;
  }

  // Get user from DB
  const user = await conversation.external(async () => {
    return prisma.user.findUnique({ where: { telegramId: from.id } });
  });

  if (!user) {
    await ctx.reply('Please use /start to register first.');
    return;
  }

  const maxLimit = user.kycStatus === 'VERIFIED' ? MAX_TRADE_USDT_VERIFIED : MAX_TRADE_USDT_UNVERIFIED;

  // --- Step 1: Amount ---
  await ctx.reply(
    `<b>Create Sell Order</b>\n\n` +
    `How much USDT are you selling?\n` +
    `(Min: ${MIN_TRADE_USDT} USDT, Max: ${maxLimit} USDT)\n\n` +
    `Send /cancel to abort.`,
    { parse_mode: 'HTML' },
  );

  let amount: number = 0;
  while (true) {
    const amountCtx = await conversation.waitFor('message:text');
    const text = amountCtx.message.text;

    if (text === '/cancel') {
      await amountCtx.reply('Sell order cancelled.');
      return;
    }

    const parsed = Number(text);
    if (isNaN(parsed) || parsed <= 0) {
      await amountCtx.reply('Please enter a valid positive number.');
      continue;
    }

    if (parsed < MIN_TRADE_USDT) {
      await amountCtx.reply(`Minimum amount is ${MIN_TRADE_USDT} USDT.`);
      continue;
    }

    if (parsed > maxLimit) {
      await amountCtx.reply(
        `Maximum amount is ${maxLimit} USDT.` +
        (user.kycStatus !== 'VERIFIED' ? '\nGet verified to increase your limit!' : ''),
      );
      continue;
    }

    amount = parsed;
    break;
  }

  // --- Step 2: Price ---
  await ctx.reply(
    `Amount: <b>${amount.toFixed(2)} USDT</b>\n\n` +
    `What is your price per USDT in TTD?\n` +
    `(Reasonable range: 5.00 - 15.00 TTD/USDT)\n\n` +
    `Send /cancel to abort.`,
    { parse_mode: 'HTML' },
  );

  let pricePerUsdt: number = 0;
  while (true) {
    const priceCtx = await conversation.waitFor('message:text');
    const text = priceCtx.message.text;

    if (text === '/cancel') {
      await priceCtx.reply('Sell order cancelled.');
      return;
    }

    const parsed = Number(text);
    if (isNaN(parsed) || parsed <= 0) {
      await priceCtx.reply('Please enter a valid positive number.');
      continue;
    }

    if (parsed < 5.0 || parsed > 15.0) {
      await priceCtx.reply('Price should be between 5.00 and 15.00 TTD/USDT.');
      continue;
    }

    pricePerUsdt = parsed;
    break;
  }

  // --- Step 3: Payment Methods ---
  const selectedMethods: string[] = [];
  const methods = SUPPORTED_PAYMENT_METHODS as readonly string[];

  const pmMsg = await ctx.reply(
    `Amount: <b>${amount.toFixed(2)} USDT</b> @ <b>${pricePerUsdt.toFixed(2)} TTD</b>\n\n` +
    `Select your accepted payment methods:\n` +
    `(Tap to toggle, then tap Done)`,
    {
      parse_mode: 'HTML',
      reply_markup: buildPaymentMethodKeyboard(selectedMethods),
    },
  );

  while (true) {
    const cbCtx = await conversation.waitForCallbackQuery(/^pm_(select:\d+|done)$/);
    const data = cbCtx.callbackQuery.data;

    if (data === 'pm_done') {
      if (selectedMethods.length === 0) {
        await cbCtx.answerCallbackQuery({ text: 'Select at least one payment method.', show_alert: true });
        continue;
      }
      await cbCtx.answerCallbackQuery();
      break;
    }

    // Toggle selection
    const indexStr = data.replace('pm_select:', '');
    const index = Number(indexStr);
    if (index >= 0 && index < methods.length) {
      const method = methods[index];
      const existingIndex = selectedMethods.indexOf(method);
      if (existingIndex >= 0) {
        selectedMethods.splice(existingIndex, 1);
      } else {
        selectedMethods.push(method);
      }
    }

    await cbCtx.answerCallbackQuery();

    // Update the keyboard to reflect current selections
    try {
      await cbCtx.editMessageReplyMarkup({
        reply_markup: buildPaymentMethodKeyboard(selectedMethods),
      });
    } catch {
      // Message may not have changed, ignore
    }
  }

  // --- Step 4: Bank Details ---
  await ctx.reply(
    `Payment methods: <b>${selectedMethods.join(', ')}</b>\n\n` +
    `Enter your bank/payment details for buyers:\n` +
    `(e.g., "Republic Bank, Account: 123456789, Name: John Doe")\n\n` +
    `Send /cancel to abort.`,
    { parse_mode: 'HTML' },
  );

  let bankDetails: string = '';
  while (true) {
    const detailsCtx = await conversation.waitFor('message:text');
    const text = detailsCtx.message.text;

    if (text === '/cancel') {
      await detailsCtx.reply('Sell order cancelled.');
      return;
    }

    if (text.trim().length < 5) {
      await detailsCtx.reply('Please provide more detailed bank/payment information.');
      continue;
    }

    bankDetails = text.trim();
    break;
  }

  // --- Step 5: Confirmation ---
  const totalFiat = amount * pricePerUsdt;

  await ctx.reply(
    `<b>Order Summary</b>\n\n` +
    `Selling: <b>${amount.toFixed(2)} USDT</b>\n` +
    `Price: <b>${pricePerUsdt.toFixed(2)} TTD/USDT</b>\n` +
    `Total: <b>${totalFiat.toFixed(2)} TTD</b>\n` +
    `Payment: ${selectedMethods.join(', ')}\n` +
    `Bank Details: <code>${bankDetails}</code>\n\n` +
    `Confirm this order?`,
    {
      parse_mode: 'HTML',
      reply_markup: confirmCancelKeyboard('sell_confirm', 'sell_cancel'),
    },
  );

  const confirmCtx = await conversation.waitForCallbackQuery(/^sell_(confirm|cancel)$/);
  await confirmCtx.answerCallbackQuery();

  if (confirmCtx.callbackQuery.data === 'sell_cancel') {
    await confirmCtx.editMessageText('Sell order cancelled.');
    return;
  }

  // Create the order in DB
  try {
    const order = await conversation.external(async () => {
      return prisma.order.create({
        data: {
          userId: user.id,
          type: 'SELL',
          amount,
          remainingAmount: amount,
          pricePerUsdt,
          paymentMethods: selectedMethods,
          bankDetails,
          status: 'ACTIVE',
        },
      });
    });

    await confirmCtx.editMessageText(
      `<b>Sell Order Created!</b>\n\n` +
      `Selling: <b>${amount.toFixed(2)} USDT</b> @ ${pricePerUsdt.toFixed(2)} TTD\n` +
      `Order ID: <code>${order.id}</code>\n\n` +
      `Your order is now visible to buyers. You'll be notified when someone accepts it.`,
      { parse_mode: 'HTML' },
    );
  } catch (err) {
    console.error('Failed to create sell order:', err);
    await confirmCtx.editMessageText(
      'Failed to create the order. Please try again with /sell.',
    );
  }
}
