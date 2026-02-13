// TON / USDT
export const USDT_MASTER_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
export const USDT_DECIMALS = 6;

// Fee configuration
export const PLATFORM_FEE_PERCENT = 0.5;
export const FEE_CONFIG = {
  baseFeePercent: 0.5,
  feeModel: 'seller' as const,
  minFeeUSDT: 0.01,
  volumeDiscounts: [
    { minMonthlyVolume: 1000, feePercent: 0.40 },
    { minMonthlyVolume: 10000, feePercent: 0.30 },
    { minMonthlyVolume: 50000, feePercent: 0.10 },
  ],
  promoFeePercent: null as number | null,
  promoExpiresAt: null as string | null,
};

// Escrow timeouts
export const ESCROW_TIMEOUT_SECONDS = 21600;
export const ESCROW_FUNDING_TIMEOUT = 1800;

// Trade limits (USDT)
export const MIN_TRADE_USDT = 1;
export const MAX_TRADE_USDT_UNVERIFIED = 500;
export const MAX_TRADE_USDT_VERIFIED = 10000;
export const TTD_USD_APPROX_RATE = 6.80;

// Currency-specific minimum fiat amounts
export const CURRENCY_MIN_FIAT: Record<string, number> = {
  TTD: 5.00,
  BBD: 2.00,
  XCD: 3.00,
  JMD: 150.00,
  GYD: 200.00,
  VES: 35.00,
  EUR: 1.00,
  SRD: 35.00,
  XCG: 2.00,
};

// Legacy exports for backwards compatibility
export const SUPPORTED_BANKS = [
  'Republic Bank', 'First Citizens', 'Scotiabank', 'RBC Royal Bank', 'JMMB Bank'
] as const;
export const SUPPORTED_PAYMENT_METHODS = [
  ...SUPPORTED_BANKS, 'Linx', 'PayWise', 'Cash (in-person)'
] as const;

// Full multi-currency config
export interface CurrencyBank {
  name: string;
  code: string;
  swift: string;
}

export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  flag: string;
  country: string;
  decimalPlaces: number;
  banks: CurrencyBank[];
  paymentMethods: string[];
  peggedTo?: { currency: string; rate: number };
}

export const SUPPORTED_CURRENCIES: Record<string, CurrencyConfig> = {
  TTD: {
    code: 'TTD',
    name: 'Trinidad & Tobago Dollar',
    symbol: 'TT$',
    flag: '\u{1F1F9}\u{1F1F9}',
    country: 'Trinidad and Tobago',
    decimalPlaces: 2,
    banks: [
      { name: 'Republic Bank', code: 'REPUBLIC', swift: 'RABORUTT' },
      { name: 'First Citizens Bank', code: 'FCB', swift: 'FCBKTTPS' },
      { name: 'Scotiabank Trinidad', code: 'SCOTIA_TT', swift: 'NABORUTT' },
      { name: 'RBC Royal Bank', code: 'RBC_TT', swift: 'RBTTTTPX' },
      { name: 'JMMB Bank', code: 'JMMB_TT', swift: 'JMMBTTPS' },
      { name: 'Citibank Trinidad', code: 'CITI_TT', swift: 'CITITTPS' },
      { name: 'Bank of Baroda', code: 'BOB_TT', swift: 'BARBTTPX' },
    ],
    paymentMethods: ['Bank Transfer', 'Linx', 'WiPay', 'Cash Deposit'],
  },
  BBD: {
    code: 'BBD',
    name: 'Barbados Dollar',
    symbol: 'BDS$',
    flag: '\u{1F1E7}\u{1F1E7}',
    country: 'Barbados',
    decimalPlaces: 2,
    banks: [
      { name: 'Republic Bank Barbados', code: 'REPUBLIC_BB', swift: 'RABOBBBR' },
      { name: 'FirstCaribbean International Bank', code: 'FCIB_BB', swift: 'FCIBBBBB' },
      { name: 'Scotiabank Barbados', code: 'SCOTIA_BB', swift: 'NOSCBBBB' },
      { name: 'RBC Royal Bank Barbados', code: 'RBC_BB', swift: 'RBTTBBBR' },
      { name: 'CIBC First Caribbean', code: 'CIBC_BB', swift: 'FCIBBBBB' },
      { name: 'Sagicor Bank', code: 'SAGICOR_BB', swift: '' },
    ],
    paymentMethods: ['Bank Transfer', 'Cash Deposit'],
  },
  XCD: {
    code: 'XCD',
    name: 'Eastern Caribbean Dollar',
    symbol: 'EC$',
    flag: '\u{1F1E6}\u{1F1EC}',
    country: 'Eastern Caribbean (AG, DM, GD, KN, LC, VC)',
    decimalPlaces: 2,
    banks: [
      { name: 'Bank of Saint Lucia', code: 'BOSL', swift: '' },
      { name: 'FirstCaribbean International (EC)', code: 'FCIB_EC', swift: '' },
      { name: 'Republic Bank Grenada', code: 'REPUBLIC_GD', swift: '' },
      { name: 'Bank of Nevis', code: 'BON', swift: '' },
      { name: 'Scotiabank (EC)', code: 'SCOTIA_EC', swift: '' },
      { name: 'Eastern Caribbean Amalgamated Bank', code: 'ECAB', swift: '' },
      { name: 'St Kitts-Nevis-Anguilla National Bank', code: 'SKNANB', swift: '' },
      { name: 'Grenada Co-operative Bank', code: 'GCB', swift: '' },
      { name: '1st National Bank St Lucia', code: 'FNB_LC', swift: '' },
    ],
    paymentMethods: ['Bank Transfer', 'Cash Deposit'],
  },
  JMD: {
    code: 'JMD',
    name: 'Jamaican Dollar',
    symbol: 'J$',
    flag: '\u{1F1EF}\u{1F1F2}',
    country: 'Jamaica',
    decimalPlaces: 2,
    banks: [
      { name: 'National Commercial Bank (NCB)', code: 'NCB_JM', swift: 'JABORJMK' },
      { name: 'Scotiabank Jamaica', code: 'SCOTIA_JM', swift: 'NOSCJMKN' },
      { name: 'JMMB Bank Jamaica', code: 'JMMB_JM', swift: '' },
      { name: 'Sagicor Bank Jamaica', code: 'SAGICOR_JM', swift: '' },
      { name: 'First Global Bank', code: 'FGB_JM', swift: '' },
      { name: 'CIBC FirstCaribbean Jamaica', code: 'CIBC_JM', swift: '' },
      { name: 'JN Bank', code: 'JN_JM', swift: '' },
      { name: 'Bank of Nova Scotia Jamaica', code: 'BNS_JM', swift: '' },
    ],
    paymentMethods: ['Bank Transfer', 'Cash Deposit', 'Bill Payment'],
  },
  GYD: {
    code: 'GYD',
    name: 'Guyanese Dollar',
    symbol: 'G$',
    flag: '\u{1F1EC}\u{1F1FE}',
    country: 'Guyana',
    decimalPlaces: 2,
    banks: [
      { name: 'Demerara Bank', code: 'DEMERARA', swift: 'DEMBGYGE' },
      { name: 'Republic Bank Guyana', code: 'REPUBLIC_GY', swift: '' },
      { name: 'Guyana Bank for Trade & Industry', code: 'GBTI', swift: 'GABORGYG' },
      { name: 'Citizens Bank Guyana', code: 'CITIZENS_GY', swift: '' },
      { name: 'Bank of Baroda Guyana', code: 'BOB_GY', swift: '' },
      { name: 'Scotiabank Guyana', code: 'SCOTIA_GY', swift: '' },
    ],
    paymentMethods: ['Bank Transfer', 'Cash Deposit', 'Mobile Money'],
  },
  VES: {
    code: 'VES',
    name: 'Venezuelan Bol\u00edvar',
    symbol: 'Bs.',
    flag: '\u{1F1FB}\u{1F1EA}',
    country: 'Venezuela',
    decimalPlaces: 2,
    banks: [
      { name: 'Banco de Venezuela', code: 'BDV', swift: 'BVENVECA' },
      { name: 'Banesco', code: 'BANESCO', swift: 'BABORVCA' },
      { name: 'Mercantil Banco', code: 'MERCANTIL', swift: 'BAMRVECA' },
      { name: 'BBVA Provincial', code: 'PROVINCIAL', swift: 'PROVVECA' },
      { name: 'Banco Nacional de Cr\u00e9dito (BNC)', code: 'BNC', swift: '' },
      { name: 'Banco Exterior', code: 'EXTERIOR', swift: '' },
      { name: 'Banco del Tesoro', code: 'TESORO', swift: '' },
      { name: 'Bancamiga', code: 'BANCAMIGA', swift: '' },
    ],
    paymentMethods: ['Bank Transfer', 'Pago M\u00f3vil', 'Zelle', 'Cash USD'],
  },
  EUR: {
    code: 'EUR',
    name: 'Euro',
    symbol: '\u20ac',
    flag: '\u{1F1EA}\u{1F1FA}',
    country: 'Martinique & Guadeloupe (French Overseas)',
    decimalPlaces: 2,
    banks: [
      { name: 'Banque des Antilles Fran\u00e7aises (BDAF)', code: 'BDAF', swift: '' },
      { name: 'BNP Paribas Martinique', code: 'BNP_MQ', swift: 'BNPAFRPP' },
      { name: 'Cr\u00e9dit Agricole Martinique/Guadeloupe', code: 'CA_MQ', swift: '' },
      { name: 'Soci\u00e9t\u00e9 G\u00e9n\u00e9rale Antilles', code: 'SG_MQ', swift: '' },
      { name: 'Bred Banque Populaire', code: 'BRED_MQ', swift: '' },
      { name: 'La Banque Postale', code: 'LBP_MQ', swift: '' },
      { name: "Caisse d'\u00c9pargne", code: 'CE_MQ', swift: '' },
      { name: 'Cr\u00e9dit Mutuel', code: 'CM_MQ', swift: '' },
    ],
    paymentMethods: ['Bank Transfer (SEPA)', 'Cash Deposit', 'Carte Bancaire'],
  },
  SRD: {
    code: 'SRD',
    name: 'Surinamese Dollar',
    symbol: 'Sr$',
    flag: '\u{1F1F8}\u{1F1F7}',
    country: 'Suriname',
    decimalPlaces: 2,
    banks: [
      { name: 'De Surinaamsche Bank (DSB)', code: 'DSB', swift: 'SABORSR2' },
      { name: 'Hakrinbank', code: 'HAKRIN', swift: 'HAKRSR2P' },
      { name: 'Finabank', code: 'FINA', swift: 'FINASRPA' },
      { name: 'Republic Bank Suriname', code: 'REPUBLIC_SR', swift: '' },
      { name: 'Surinaamse Postspaarbank', code: 'SPSB', swift: '' },
      { name: 'Volkscredietbank', code: 'VCB', swift: '' },
      { name: 'Godo (Government Owned)', code: 'GODO', swift: '' },
    ],
    paymentMethods: ['Bank Transfer', 'Cash Deposit'],
  },
  XCG: {
    code: 'XCG',
    name: 'Caribbean Guilder',
    symbol: 'Cg',
    flag: '\u{1F1E8}\u{1F1FC}',
    country: 'Cura\u00e7ao & Sint Maarten',
    decimalPlaces: 2,
    peggedTo: { currency: 'USD', rate: 1.79 },
    banks: [
      { name: "Maduro & Curiel's Bank (MCB)", code: 'MCB', swift: 'MCBKCWCU' },
      { name: 'Banco di Caribe', code: 'BDC', swift: 'BDCRCWCU' },
      { name: 'FirstCaribbean International Bank (Cura\u00e7ao)', code: 'FCIB_CW', swift: '' },
      { name: 'RBC Royal Bank (Cura\u00e7ao)', code: 'RBC_CW', swift: '' },
      { name: 'Orco Bank', code: 'ORCO', swift: 'ORCOCWCU' },
      { name: 'Vidanova Bank', code: 'VIDANOVA', swift: '' },
      { name: 'Windward Islands Bank (Sint Maarten)', code: 'WIB', swift: '' },
    ],
    paymentMethods: ['Bank Transfer', 'Cash Deposit'],
  },
};

export const CURRENCY_CODES = Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[];

export type CurrencyCode = 'TTD' | 'BBD' | 'XCD' | 'JMD' | 'GYD' | 'VES' | 'EUR' | 'SRD' | 'XCG';

// Fee calculation helper
export function calculateFee(amountUSDT: number, userMonthlyVolume?: number): {
  feePercent: number;
  feeAmount: number;
  netAmount: number;
} {
  let feePercent = FEE_CONFIG.baseFeePercent;

  // Check promo
  if (FEE_CONFIG.promoFeePercent !== null) {
    if (!FEE_CONFIG.promoExpiresAt || new Date(FEE_CONFIG.promoExpiresAt) > new Date()) {
      feePercent = FEE_CONFIG.promoFeePercent;
    }
  }

  // Check volume discounts
  if (userMonthlyVolume !== undefined) {
    for (const tier of [...FEE_CONFIG.volumeDiscounts].reverse()) {
      if (userMonthlyVolume >= tier.minMonthlyVolume) {
        feePercent = tier.feePercent;
        break;
      }
    }
  }

  const feeAmount = Math.max(
    Math.round(amountUSDT * (feePercent / 100) * 100) / 100,
    FEE_CONFIG.minFeeUSDT
  );

  return {
    feePercent,
    feeAmount,
    netAmount: Math.round((amountUSDT - feeAmount) * 100) / 100,
  };
}

// Reputation tier helpers
export interface ReputationTier {
  badge: string;
  label: string;
}

export function getReputationTier(trades: number, score: number): ReputationTier {
  if (trades >= 100 && score >= 90) return { badge: '\u{1F3C6}', label: 'Trusted Trader' };
  if (trades >= 50 && score >= 40) return { badge: '\u2b50', label: 'Experienced' };
  if (trades >= 10 && score >= 8) return { badge: '\u2705', label: 'Verified' };
  if (trades >= 1) return { badge: '\u{1F195}', label: 'New Trader' };
  return { badge: '\u{1F464}', label: 'Unrated' };
}
