export const USDT_MASTER_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
export const USDT_DECIMALS = 6;
export const PLATFORM_FEE_PERCENT = 1;
export const ESCROW_TIMEOUT_SECONDS = 21600;
export const ESCROW_FUNDING_TIMEOUT = 1800;
export const MIN_TRADE_USDT = 10;
export const MAX_TRADE_USDT_UNVERIFIED = 500;
export const MAX_TRADE_USDT_VERIFIED = 10000;
export const TTD_USD_APPROX_RATE = 6.80;
export const SUPPORTED_BANKS = [
  'Republic Bank', 'First Citizens', 'Scotiabank', 'RBC Royal Bank', 'JMMB Bank'
] as const;
export const SUPPORTED_PAYMENT_METHODS = [
  ...SUPPORTED_BANKS, 'Linx', 'PayWise', 'Cash (in-person)'
] as const;
