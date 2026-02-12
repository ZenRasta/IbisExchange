import { InlineKeyboard } from 'grammy';
import { SUPPORTED_PAYMENT_METHODS } from '@ibis/shared';

/**
 * Main menu keyboard shown after /start
 */
export function mainMenuKeyboard(miniAppUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp('Open Exchange', miniAppUrl)
    .row()
    .text('Sell USDT', 'cmd:sell')
    .text('Buy USDT', 'cmd:buy')
    .row()
    .text('My Trades', 'cmd:trades')
    .text('Profile', 'cmd:profile')
    .row()
    .text('Get Verified', 'cmd:verify');
}

/**
 * Trade actions keyboard for buyer
 */
export function buyerTradeActionsKeyboard(tradeId: string, miniAppUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp('Lock Escrow', `${miniAppUrl}/trade/${tradeId}`)
    .row()
    .text('Cancel Trade', `cancel_trade:${tradeId}`);
}

/**
 * Keyboard shown to buyer after escrow is locked
 */
export function buyerEscrowLockedKeyboard(tradeId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('I Sent Payment', `payment_sent:${tradeId}`);
}

/**
 * Keyboard shown to seller after buyer says they sent fiat
 */
export function sellerPaymentConfirmKeyboard(tradeId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Payment Received', `confirm_payment:${tradeId}`)
    .row()
    .text('Not Received', `dispute:${tradeId}`)
    .text('Dispute', `dispute:${tradeId}`);
}

/**
 * Trade actions keyboard based on role and trade status
 */
export function tradeActionsKeyboard(tradeId: string, role: 'buyer' | 'seller'): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (role === 'buyer') {
    kb.text('I Sent Payment', `payment_sent:${tradeId}`)
      .row()
      .text('Dispute', `dispute:${tradeId}`);
  } else {
    kb.text('Payment Received', `confirm_payment:${tradeId}`)
      .row()
      .text('Dispute', `dispute:${tradeId}`);
  }

  return kb;
}

/**
 * Payment method multi-select keyboard for sell flow.
 * Selected methods have a checkmark prefix.
 */
export function paymentMethodKeyboard(selected: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  const methods = SUPPORTED_PAYMENT_METHODS as readonly string[];

  for (let i = 0; i < methods.length; i++) {
    const method = methods[i];
    const isSelected = selected.includes(method);
    const label = isSelected ? `[x] ${method}` : method;
    kb.text(label, `pm_select:${i}`);
    if (i % 2 === 1) kb.row();
  }

  // Final row with done button
  if (methods.length % 2 === 1) kb.row();
  kb.text('Done', 'pm_done');

  return kb;
}

/**
 * Confirm / Cancel keyboard
 */
export function confirmCancelKeyboard(confirmData: string = 'confirm', cancelData: string = 'cancel'): InlineKeyboard {
  return new InlineKeyboard()
    .text('Confirm', confirmData)
    .text('Cancel', cancelData);
}

/**
 * Dispute resolution keyboard for admin
 */
export function disputeResolutionKeyboard(tradeId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Release to Buyer', `resolve_dispute:${tradeId}:buyer`)
    .row()
    .text('Refund to Seller', `resolve_dispute:${tradeId}:seller`);
}

/**
 * Open Mini App keyboard with optional path
 */
export function openMiniAppKeyboard(miniAppUrl: string, path?: string): InlineKeyboard {
  const url = path ? `${miniAppUrl}${path}` : miniAppUrl;
  return new InlineKeyboard().webApp('Open App', url);
}

/**
 * Accept order button
 */
export function acceptOrderKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Accept Order', `accept_order:${orderId}`);
}

/**
 * View more in Mini App
 */
export function viewMoreKeyboard(miniAppUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp('View More in App', `${miniAppUrl}/orders`);
}

/**
 * Get verified keyboard for KYC prompt
 */
export function getVerifiedKeyboard(miniAppUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp('Get Verified', `${miniAppUrl}/kyc`);
}
