export const CURRENCIES: Record<string, { symbol: string; flag: string; name: string }> = {
  TTD: { symbol: 'TT$', flag: '\u{1F1F9}\u{1F1F9}', name: 'Trinidad & Tobago Dollar' },
  BBD: { symbol: 'BDS$', flag: '\u{1F1E7}\u{1F1E7}', name: 'Barbados Dollar' },
  XCD: { symbol: 'EC$', flag: '\u{1F1E6}\u{1F1EC}', name: 'Eastern Caribbean Dollar' },
  JMD: { symbol: 'J$', flag: '\u{1F1EF}\u{1F1F2}', name: 'Jamaican Dollar' },
  GYD: { symbol: 'G$', flag: '\u{1F1EC}\u{1F1FE}', name: 'Guyanese Dollar' },
  VES: { symbol: 'Bs.', flag: '\u{1F1FB}\u{1F1EA}', name: 'Venezuelan Bol\u00edvar' },
  EUR: { symbol: '\u20AC', flag: '\u{1F1EA}\u{1F1FA}', name: 'Euro' },
  SRD: { symbol: 'Sr$', flag: '\u{1F1F8}\u{1F1F7}', name: 'Surinamese Dollar' },
  XCG: { symbol: 'Cg', flag: '\u{1F1E8}\u{1F1FC}', name: 'Caribbean Guilder' },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);

export const DEFAULT_CURRENCY = 'TTD';

export const PAYMENT_METHODS_BY_CURRENCY: Record<string, string[]> = {
  TTD: ['Bank Transfer', 'Linx', 'WiPay', 'Cash Deposit'],
  BBD: ['Bank Transfer', 'Cash Deposit'],
  XCD: ['Bank Transfer', 'Cash Deposit'],
  JMD: ['Bank Transfer', 'Cash Deposit', 'Bill Payment'],
  GYD: ['Bank Transfer', 'Cash Deposit', 'Mobile Money'],
  VES: ['Bank Transfer', 'Pago M\u00f3vil', 'Zelle', 'Cash USD'],
  EUR: ['Bank Transfer (SEPA)', 'Cash Deposit', 'Carte Bancaire'],
  SRD: ['Bank Transfer', 'Cash Deposit'],
  XCG: ['Bank Transfer', 'Cash Deposit'],
};

export function getCurrencySymbol(code?: string): string {
  return CURRENCIES[code || DEFAULT_CURRENCY]?.symbol || code || DEFAULT_CURRENCY;
}

export function getCurrencyFlag(code?: string): string {
  return CURRENCIES[code || DEFAULT_CURRENCY]?.flag || '';
}

export function getPaymentMethods(currency: string): string[] {
  return PAYMENT_METHODS_BY_CURRENCY[currency] || PAYMENT_METHODS_BY_CURRENCY[DEFAULT_CURRENCY];
}
