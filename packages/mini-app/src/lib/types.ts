export interface Order {
  id: string;
  userId: string;
  type: 'BUY' | 'SELL';
  amount: number;
  remainingAmount: number;
  pricePerUsdt: number;
  paymentMethods: string[];
  bankDetails?: string;
  minTradeAmount?: number;
  maxTradeAmount?: number;
  currency?: string;
  status: 'ACTIVE' | 'PARTIALLY_MATCHED' | 'MATCHED' | 'CANCELLED' | 'EXPIRED';
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  user?: UserProfile;
}

export interface Trade {
  id: string;
  escrowId?: number;
  orderId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  pricePerUsdt: number;
  fiatAmount: number;
  fiatCurrency: string;
  paymentMethod: string;
  paymentReference?: string;
  escrowTxHash?: string;
  releaseTxHash?: string;
  bankDetails?: string;
  escrowLockedAt?: string;
  fiatSentAt?: string;
  completedAt?: string;
  disputedAt?: string;
  disputeReason?: string;
  disputeResolution?: string;
  feeAmount?: number;
  feePercent?: number;
  status: TradeStatus;
  buyerRating?: number;
  sellerRating?: number;
  createdAt: string;
  updatedAt: string;
  buyer?: UserProfile;
  seller?: UserProfile;
  order?: Order;
}

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

export interface UserProfile {
  id: string;
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  tonAddress?: string;
  kycStatus: 'NOT_STARTED' | 'PENDING' | 'ACTION_REQUIRED' | 'VERIFIED' | 'REJECTED';
  kycVerifiedAt?: string;
  maxTradeAmount: number;
  reputationScore: number;
  totalTrades: number;
  successfulTrades: number;
  totalVolume: number;
  totalUpvotes?: number;
  totalDownvotes?: number;
  isBanned?: boolean;
  isAdmin?: boolean;
  preferredCurrency?: string;
  createdAt: string;
}

export interface UserStats {
  activeOrders: number;
  pendingTrades: number;
  completedTrades: number;
  totalVolume: number;
  reputationScore: number;
}

export interface KycStatus {
  status: 'NOT_STARTED' | 'PENDING' | 'ACTION_REQUIRED' | 'VERIFIED' | 'REJECTED';
  verifiedAt?: string;
}

export interface CurrencyRate {
  avgSellRate: number;
  orderCount: number;
  minRate: number;
  maxRate: number;
  updated: string;
}

export interface LeaderboardUser {
  id: string;
  username?: string;
  firstName: string;
  reputationScore: number;
  totalTrades: number;
  totalVolume: number;
  totalUpvotes: number;
  totalDownvotes: number;
  kycStatus: string;
  reputationTier: { badge: string; label: string };
  createdAt: string;
}

export interface DisputeInfo {
  id: string;
  tradeId: string;
  reason: string;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface AdminStats {
  totalTrades: number;
  totalVolume: number;
  activeUsers: number;
  openDisputes: number;
  feesCollected: number;
  bannedUsers: number;
  volumeByCurrency: Record<string, number>;
}
