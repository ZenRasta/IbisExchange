import type { User, Order, Trade } from '@prisma/client';

export type { User, Order, Trade };

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

export type SupportedBank = 'Republic Bank' | 'First Citizens' | 'Scotiabank' | 'RBC Royal Bank' | 'JMMB Bank';
export type PaymentMethod = SupportedBank | 'Linx' | 'PayWise' | 'Cash (in-person)';
