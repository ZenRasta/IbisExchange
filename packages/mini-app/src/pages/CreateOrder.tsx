import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { useHaptic } from '../hooks/useHaptic';

const PAYMENT_METHODS = [
  'Republic Bank',
  'First Citizens',
  'Scotiabank',
  'RBC Royal Bank',
  'JMMB Bank',
  'Linx',
  'PayWise',
  'Cash (in-person)',
];

const DEFAULT_RATE = 6.80;

export default function CreateOrder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { impact, notification } = useHaptic();

  const [type, setType] = useState<'BUY' | 'SELL'>(
    (searchParams.get('type')?.toUpperCase() as 'BUY' | 'SELL') || 'SELL'
  );
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState(DEFAULT_RATE.toString());
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [bankDetails, setBankDetails] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = parseFloat(amount) || 0;
  const priceNum = parseFloat(price) || 0;
  const totalTtd = amountNum * priceNum;

  useEffect(() => {
    const t = searchParams.get('type')?.toUpperCase();
    if (t === 'BUY' || t === 'SELL') setType(t);
  }, [searchParams]);

  const toggleMethod = (method: string) => {
    impact('light');
    setSelectedMethods(prev =>
      prev.includes(method)
        ? prev.filter(m => m !== method)
        : [...prev, method]
    );
  };

  const validate = (): string | null => {
    if (amountNum <= 0) return 'Enter a valid USDT amount';
    if (amountNum < 10) return 'Minimum order is 10 USDT';
    if (amountNum > 10000) return 'Maximum order is 10,000 USDT';
    if (priceNum <= 0) return 'Enter a valid price per USDT';
    if (priceNum < 5 || priceNum > 10) return 'Price must be between 5-10 TTD per USDT';
    if (selectedMethods.length === 0) return 'Select at least one payment method';
    if (type === 'SELL' && !bankDetails.trim()) return 'Enter your bank details for buyers';
    return null;
  };

  const handleReview = () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      notification('error');
      return;
    }
    setError(null);
    impact('medium');
    setShowConfirm(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiCall('POST', '/api/orders', {
        type,
        amount: amountNum,
        pricePerUsdt: priceNum,
        paymentMethods: selectedMethods,
        bankDetails: type === 'SELL' ? bankDetails.trim() : undefined,
      });
      notification('success');
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order');
      notification('error');
      setShowConfirm(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Confirmation Modal
  if (showConfirm) {
    return (
      <div className="px-4 py-4 animate-slide-up">
        <h2 className="text-tg-text text-lg font-bold mb-4">Confirm Order</h2>

        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4 space-y-3">
          <div className="flex justify-between">
            <span className="text-tg-hint text-sm">Type</span>
            <span className={`text-sm font-semibold ${type === 'BUY' ? 'text-[#22c55e]' : 'text-tg-accent'}`}>
              {type === 'BUY' ? 'Buy USDT' : 'Sell USDT'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-tg-hint text-sm">Amount</span>
            <span className="text-tg-text text-sm font-semibold">{amountNum} USDT</span>
          </div>
          <div className="flex justify-between">
            <span className="text-tg-hint text-sm">Price</span>
            <span className="text-tg-text text-sm font-semibold">{priceNum} TTD/USDT</span>
          </div>
          <div className="border-t border-tg-secondary-bg pt-2 flex justify-between">
            <span className="text-tg-hint text-sm">Total</span>
            <span className="text-tg-text font-bold">{totalTtd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TTD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-tg-hint text-sm">Payment</span>
            <span className="text-tg-text text-sm">{selectedMethods.join(', ')}</span>
          </div>
          {type === 'SELL' && bankDetails && (
            <div>
              <span className="text-tg-hint text-xs block mb-1">Bank Details</span>
              <p className="text-tg-text text-sm bg-tg-secondary-bg rounded-lg p-2">{bankDetails}</p>
            </div>
          )}
        </div>

        {error && (
          <p className="text-tg-destructive text-sm mb-3">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setShowConfirm(false)}
            disabled={submitting}
            className="flex-1 bg-tg-secondary-bg text-tg-text py-3 rounded-xl font-semibold"
          >
            Edit
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 bg-tg-button text-tg-button-text py-3 rounded-xl font-semibold active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Confirm'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 animate-fade-in">
      <h2 className="text-tg-text text-lg font-bold mb-4">Create Order</h2>

      {/* Buy/Sell Toggle */}
      <div className="flex bg-tg-section-bg rounded-xl p-1 mb-4">
        {(['SELL', 'BUY'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setType(t); impact('light'); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              type === t
                ? t === 'BUY' ? 'bg-[#22c55e] text-white' : 'bg-tg-button text-tg-button-text'
                : 'text-tg-hint'
            }`}
          >
            {t === 'SELL' ? 'Sell USDT' : 'Buy USDT'}
          </button>
        ))}
      </div>

      {/* Amount */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-3">
        <label className="text-tg-hint text-xs block mb-2">Amount (USDT)</label>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.00"
          min="10"
          max="10000"
          className="w-full bg-transparent text-tg-text text-2xl font-bold outline-none placeholder-tg-hint/40"
        />
        <div className="flex gap-2 mt-2">
          {[50, 100, 500, 1000].map(v => (
            <button
              key={v}
              onClick={() => { setAmount(v.toString()); impact('light'); }}
              className="text-xs bg-tg-secondary-bg text-tg-hint px-3 py-1 rounded-full"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Price per USDT */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-3">
        <label className="text-tg-hint text-xs block mb-2">Price per USDT (TTD)</label>
        <input
          type="number"
          inputMode="decimal"
          value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder="6.80"
          step="0.01"
          className="w-full bg-transparent text-tg-text text-2xl font-bold outline-none placeholder-tg-hint/40"
        />
        <p className="text-tg-hint text-xs mt-1">
          Market rate: ~{DEFAULT_RATE.toFixed(2)} TTD/USDT
        </p>
      </div>

      {/* Total Preview */}
      {amountNum > 0 && priceNum > 0 && (
        <div className="bg-tg-button/10 rounded-2xl p-4 mb-3 animate-fade-in">
          <p className="text-tg-hint text-xs">Total Value</p>
          <p className="text-tg-text text-xl font-bold">
            {totalTtd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TTD
          </p>
        </div>
      )}

      {/* Payment Methods */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-3">
        <label className="text-tg-hint text-xs block mb-2">Payment Methods</label>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map(method => (
            <button
              key={method}
              onClick={() => toggleMethod(method)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                selectedMethods.includes(method)
                  ? 'bg-tg-button text-tg-button-text border-tg-button'
                  : 'bg-transparent text-tg-text border-tg-secondary-bg'
              }`}
            >
              {method}
            </button>
          ))}
        </div>
      </div>

      {/* Bank Details (for sell orders) */}
      {type === 'SELL' && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-3 animate-fade-in">
          <label className="text-tg-hint text-xs block mb-2">Bank Details (for buyers)</label>
          <textarea
            value={bankDetails}
            onChange={e => setBankDetails(e.target.value)}
            placeholder="Bank name, account number, account holder name..."
            rows={3}
            className="w-full bg-tg-secondary-bg text-tg-text rounded-lg p-3 outline-none resize-none placeholder-tg-hint/40 text-sm"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-tg-destructive text-sm mb-3 px-1">{error}</p>
      )}

      {/* Submit */}
      <button
        onClick={handleReview}
        className="w-full bg-tg-button text-tg-button-text py-3.5 rounded-xl font-semibold text-base active:scale-[0.98] transition-transform mt-2"
      >
        Review Order
      </button>
    </div>
  );
}
