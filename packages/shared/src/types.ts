import type { User, Order, Trade, TradeReview, Dispute, FeeRecord } from '@prisma/client';

export type { User, Order, Trade, TradeReview, Dispute, FeeRecord };

export type OrderType = 'BUY' | 'SELL';

export type OrderStatus = 'ACTIVE' | 'MATCHED' | 'PARTIALLY_MATCHED' | 'CANCELLED' | 'EXPIRED';

export type TradeStatus =
  | 'AWAITING_ESCROW'
  | 'ESCROW_LOCKED'
  | 'FIAT_SENT'
  | 'RELEASING'
  | 'COMPLETED'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'RESOLVED_RELEASE'
  | 'RESOLVED_REFUND'
  | 'CANCELLED'
  | 'EXPIRED';

export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'ACTION_REQUIRED' | 'VERIFIED' | 'REJECTED';

// CurrencyCode is exported from constants.ts (alongside SUPPORTED_CURRENCIES and CURRENCY_CODES)

export type DisputeReason =
  | 'payment_not_received'
  | 'payment_not_confirmed'
  | 'wrong_amount'
  | 'scam_attempt'
  | 'unresponsive'
  | 'other';

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';

export type ReviewVote = 'up' | 'down';

export type SupportedBank = 'Republic Bank' | 'First Citizens' | 'Scotiabank' | 'RBC Royal Bank' | 'JMMB Bank';
export type PaymentMethod = SupportedBank | 'Linx' | 'PayWise' | 'Cash (in-person)';
