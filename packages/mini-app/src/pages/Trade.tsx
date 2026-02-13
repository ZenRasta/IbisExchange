import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { useHaptic } from '../hooks/useHaptic';
import { getCurrencySymbol } from '../lib/currencies';
import LockEscrow from '../components/LockEscrow';
import type { Trade as TradeType, TradeStatus } from '../lib/types';

const STEPS: { status: TradeStatus; label: string }[] = [
  { status: 'AWAITING_ESCROW', label: 'Accepted' },
  { status: 'ESCROW_LOCKED', label: 'Escrow Locked' },
  { status: 'FIAT_SENT', label: 'Fiat Sent' },
  { status: 'COMPLETED', label: 'Completed' },
];

function getStepIndex(status: TradeStatus): number {
  const idx = STEPS.findIndex(s => s.status === status);
  return idx >= 0 ? idx : 0;
}

function StepIndicator({ currentStatus }: { currentStatus: TradeStatus }) {
  const currentIndex = getStepIndex(currentStatus);
  const isDisputed = currentStatus === 'DISPUTED';

  return (
    <div className="flex items-center justify-between px-2 mb-6">
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex || currentStatus === 'COMPLETED';
        const isCurrent = i === currentIndex && currentStatus !== 'COMPLETED';
        const isLast = i === STEPS.length - 1;

        return (
          <div key={step.status} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  isDisputed
                    ? 'border-tg-destructive bg-tg-destructive/10 text-tg-destructive'
                    : isDone
                    ? 'border-[#22c55e] bg-[#22c55e] text-white'
                    : isCurrent
                    ? 'border-tg-button bg-tg-button/10 text-tg-button'
                    : 'border-tg-secondary-bg bg-tg-secondary-bg text-tg-hint'
                }`}
              >
                {isDone ? '\u2713' : i + 1}
              </div>
              <span className={`text-[9px] mt-1 text-center w-16 ${
                isDone || isCurrent ? 'text-tg-text' : 'text-tg-hint'
              }`}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 ${
                i < currentIndex ? 'bg-[#22c55e]' : 'bg-tg-secondary-bg'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CountdownTimer({ deadline }: { deadline: string }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      if (hours > 0) {
        setTimeLeft(`${hours}h ${mins}m ${secs}s`);
      } else {
        setTimeLeft(`${mins}m ${secs}s`);
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const isUrgent = (() => {
    const diff = new Date(deadline).getTime() - Date.now();
    return diff < 300000; // < 5 minutes
  })();

  return (
    <span className={`font-mono text-sm ${isUrgent ? 'text-tg-destructive' : 'text-tg-accent'}`}>
      {timeLeft}
    </span>
  );
}

function StarRating({ rating, onRate }: { rating: number; onRate: (r: number) => void }) {
  return (
    <div className="flex gap-2 justify-center">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          onClick={() => onRate(star)}
          className="text-3xl transition-transform active:scale-110"
        >
          {star <= rating ? '\u2B50' : '\u2606'}
        </button>
      ))}
    </div>
  );
}

export default function Trade() {
  const { id } = useParams<{ id: string }>();
  const { impact, notification } = useHaptic();
  const [trade, setTrade] = useState<TradeType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const [isBuyer, setIsBuyer] = useState(false);

  const fetchTrade = useCallback(async () => {
    try {
      const data = await apiCall<TradeType>('GET', `/api/trades/${id}`);
      setTrade(data);
      // Determine if current user is buyer by comparing Telegram IDs
      const initData = window.Telegram?.WebApp?.initDataUnsafe;
      const tgUser = (initData as Record<string, unknown>)?.user as Record<string, unknown> | undefined;
      const telegramId = tgUser?.id ? Number(tgUser.id) : null;
      if (telegramId && data.buyer?.telegramId) {
        setIsBuyer(Number(data.buyer.telegramId) === telegramId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trade');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTrade();
    // Poll for status changes
    const interval = setInterval(fetchTrade, 10000);
    return () => clearInterval(interval);
  }, [fetchTrade]);

  const handleAction = async (endpoint: string, successMsg: string, body?: Record<string, unknown>) => {
    impact('heavy');
    setActionLoading(true);
    setError(null);
    try {
      await apiCall('POST', endpoint, body);
      notification('success');
      fetchTrade();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      notification('error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRate = async (stars: number) => {
    setRating(stars);
    impact('medium');
    try {
      await apiCall('POST', `/api/trades/${id}/rate`, { rating: stars });
      setRated(true);
      notification('success');
    } catch {
      // Rating failed silently
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-4">
        <div className="bg-tg-section-bg rounded-2xl p-6">
          <div className="skeleton h-6 w-40 rounded mb-4" />
          <div className="flex justify-between mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex flex-col items-center">
                <div className="skeleton w-8 h-8 rounded-full mb-1" />
                <div className="skeleton h-2 w-12 rounded" />
              </div>
            ))}
          </div>
          <div className="skeleton h-32 w-full rounded-xl mb-3" />
          <div className="skeleton h-12 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error && !trade) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-tg-destructive mb-3">{error}</p>
        <button
          onClick={() => { setError(null); setLoading(true); fetchTrade(); }}
          className="bg-tg-button text-tg-button-text px-6 py-2 rounded-xl text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!trade) return null;

  return (
    <div className="px-4 py-4 animate-fade-in">
      {/* Trade Header */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-tg-text font-bold text-lg">
            Trade #{trade.id.slice(-6).toUpperCase()}
          </h2>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            trade.status === 'COMPLETED' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
            trade.status === 'DISPUTED' ? 'bg-tg-destructive/10 text-tg-destructive' :
            trade.status === 'CANCELLED' || trade.status === 'EXPIRED' ? 'bg-tg-hint/10 text-tg-hint' :
            'bg-tg-accent/10 text-tg-accent'
          }`}>
            {trade.status.replace('_', ' ')}
          </span>
        </div>
        <p className="text-tg-hint text-xs">
          {isBuyer ? 'You are the buyer' : 'You are the seller'}
        </p>
      </div>

      {/* Step Indicator */}
      {trade.status !== 'CANCELLED' && trade.status !== 'EXPIRED' && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
          <StepIndicator currentStatus={trade.status} />
        </div>
      )}

      {/* Trade Details Card */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
        <h3 className="text-tg-text font-semibold mb-3">Trade Details</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-tg-hint text-sm">Amount</span>
            <span className="text-tg-text text-sm font-semibold">{trade.amount} USDT</span>
          </div>
          <div className="flex justify-between">
            <span className="text-tg-hint text-sm">Rate</span>
            <span className="text-tg-text text-sm">{trade.pricePerUsdt} {getCurrencySymbol(trade.fiatCurrency)}/USDT</span>
          </div>
          <div className="flex justify-between border-t border-tg-secondary-bg pt-2">
            <span className="text-tg-hint text-sm">Total</span>
            <span className="text-tg-text font-bold">{trade.fiatAmount.toLocaleString()} {getCurrencySymbol(trade.fiatCurrency)}</span>
          </div>
          {trade.feeAmount != null && trade.feeAmount > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-tg-hint text-sm">Platform Fee ({trade.feePercent ?? 0.5}%)</span>
                <span className="text-tg-hint text-sm">{trade.feeAmount.toFixed(2)} USDT</span>
              </div>
              <div className="flex justify-between">
                <span className="text-tg-hint text-sm">Net Amount</span>
                <span className="text-tg-text text-sm font-semibold">{(trade.amount - trade.feeAmount).toFixed(2)} USDT</span>
              </div>
            </>
          )}
          {trade.paymentReference && (
            <div className="flex justify-between">
              <span className="text-tg-hint text-sm">Payment Ref</span>
              <span className="text-tg-accent text-sm font-mono">{trade.paymentReference}</span>
            </div>
          )}
        </div>
      </div>

      {/* Status-specific Content */}

      {/* AWAITING_ESCROW - Seller: Lock escrow (seller has USDT) */}
      {trade.status === 'AWAITING_ESCROW' && !isBuyer && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4 animate-slide-up">
          <h3 className="text-tg-text font-semibold mb-1">Lock Escrow</h3>
          <p className="text-tg-hint text-sm mb-4">
            Lock your USDT in the escrow smart contract to proceed with this trade.
          </p>
          {trade.escrowId != null && (
            <LockEscrow
              tradeId={trade.id}
              escrowId={trade.escrowId}
              amount={trade.amount}
              onSuccess={() => fetchTrade()}
              onError={(err) => setError(err)}
            />
          )}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-tg-secondary-bg">
            <span className="text-tg-hint text-xs">Time remaining</span>
            <CountdownTimer
              deadline={new Date(new Date(trade.createdAt).getTime() + 30 * 60000).toISOString()}
            />
          </div>
        </div>
      )}

      {/* AWAITING_ESCROW - Buyer: Waiting for seller to lock */}
      {trade.status === 'AWAITING_ESCROW' && isBuyer && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
          <div className="text-center py-4">
            <div className="animate-spin h-8 w-8 border-2 border-tg-button border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-tg-text font-semibold">Waiting for Seller</p>
            <p className="text-tg-hint text-sm mt-1">
              The seller is locking USDT in escrow
            </p>
            <div className="mt-3">
              <CountdownTimer
                deadline={new Date(new Date(trade.createdAt).getTime() + 30 * 60000).toISOString()}
              />
            </div>
          </div>
        </div>
      )}

      {/* ESCROW_LOCKED - Buyer: Send fiat payment */}
      {trade.status === 'ESCROW_LOCKED' && isBuyer && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4 animate-slide-up">
          <h3 className="text-tg-text font-semibold mb-3">Send Payment</h3>
          <p className="text-tg-hint text-sm mb-3">
            USDT is locked in escrow. Send {trade.fiatAmount.toLocaleString()} {getCurrencySymbol(trade.fiatCurrency)} to the seller.
          </p>

          {trade.bankDetails && (
            <div className="bg-tg-secondary-bg rounded-xl p-3 mb-3">
              <p className="text-tg-hint text-xs mb-1">Seller's Bank Details</p>
              <p className="text-tg-text text-sm whitespace-pre-wrap">{trade.bankDetails}</p>
            </div>
          )}

          {trade.paymentReference && (
            <div className="bg-tg-accent/10 rounded-xl p-3 mb-4">
              <p className="text-tg-hint text-xs mb-1">Payment Reference (include in transfer)</p>
              <p className="text-tg-accent font-mono font-bold text-lg">{trade.paymentReference}</p>
            </div>
          )}

          <button
            onClick={() => handleAction(`/api/trades/${id}/fiat-sent`, 'Payment marked as sent')}
            disabled={actionLoading}
            className="w-full bg-tg-button text-tg-button-text py-3.5 rounded-xl font-semibold active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {actionLoading ? 'Confirming...' : "I've Sent Payment"}
          </button>
        </div>
      )}

      {/* ESCROW_LOCKED - Seller: Waiting for fiat */}
      {trade.status === 'ESCROW_LOCKED' && !isBuyer && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
          <div className="text-center py-4">
            <p className="text-3xl mb-2">&#x1F3E6;</p>
            <p className="text-tg-text font-semibold">Escrow Locked</p>
            <p className="text-tg-hint text-sm mt-1">
              Waiting for the buyer to send {trade.fiatAmount.toLocaleString()} {getCurrencySymbol(trade.fiatCurrency)} to your bank account
            </p>
          </div>
        </div>
      )}

      {/* FIAT_SENT - Seller: Confirm or Dispute */}
      {trade.status === 'FIAT_SENT' && !isBuyer && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4 animate-slide-up">
          <h3 className="text-tg-text font-semibold mb-3">Confirm Receipt</h3>
          <p className="text-tg-hint text-sm mb-3">
            The buyer says they've sent {trade.fiatAmount.toLocaleString()} {getCurrencySymbol(trade.fiatCurrency)}.
            Check your bank account and confirm.
          </p>

          {trade.paymentReference && (
            <div className="bg-tg-accent/10 rounded-xl p-3 mb-4">
              <p className="text-tg-hint text-xs mb-1">Payment Reference</p>
              <p className="text-tg-accent font-mono font-bold">{trade.paymentReference}</p>
            </div>
          )}

          <div className="flex items-center justify-between mb-4 text-sm">
            <span className="text-tg-hint">Auto-release in</span>
            <CountdownTimer
              deadline={new Date(new Date(trade.updatedAt).getTime() + 6 * 3600000).toISOString()}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleAction(`/api/trades/${id}/dispute`, 'Dispute opened', { reason: 'Fiat payment not received' })}
              disabled={actionLoading}
              className="flex-1 bg-tg-destructive/10 text-tg-destructive py-3 rounded-xl font-semibold text-sm"
            >
              Not Received
            </button>
            <button
              onClick={() => handleAction(`/api/trades/${id}/confirm-receipt`, 'Trade completed')}
              disabled={actionLoading}
              className="flex-1 bg-[#22c55e] text-white py-3 rounded-xl font-semibold text-sm active:scale-[0.98] transition-transform"
            >
              {actionLoading ? 'Confirming...' : 'Payment Received'}
            </button>
          </div>
        </div>
      )}

      {/* FIAT_SENT - Buyer: Waiting for confirmation */}
      {trade.status === 'FIAT_SENT' && isBuyer && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
          <div className="text-center py-4">
            <p className="text-3xl mb-2">&#x23F3;</p>
            <p className="text-tg-text font-semibold">Payment Sent</p>
            <p className="text-tg-hint text-sm mt-1">
              Waiting for the seller to confirm receipt of {trade.fiatAmount.toLocaleString()} {getCurrencySymbol(trade.fiatCurrency)}
            </p>
            <div className="mt-3">
              <span className="text-tg-hint text-xs">Auto-release in </span>
              <CountdownTimer
                deadline={new Date(new Date(trade.updatedAt).getTime() + 6 * 3600000).toISOString()}
              />
            </div>
          </div>
        </div>
      )}

      {/* COMPLETED */}
      {trade.status === 'COMPLETED' && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4 animate-slide-up">
          <div className="text-center py-4">
            <p className="text-5xl mb-3">&#x2705;</p>
            <p className="text-tg-text text-xl font-bold">Trade Completed!</p>
            <p className="text-tg-hint text-sm mt-2">
              {isBuyer
                ? `You received ${trade.amount} USDT`
                : `You received ${trade.fiatAmount.toLocaleString()} ${getCurrencySymbol(trade.fiatCurrency)}`}
            </p>
          </div>

          {/* Trade Summary */}
          <div className="bg-tg-secondary-bg rounded-xl p-3 mb-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-tg-hint">Amount</span>
              <span className="text-tg-text">{trade.amount} USDT</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-tg-hint">Rate</span>
              <span className="text-tg-text">{trade.pricePerUsdt} {getCurrencySymbol(trade.fiatCurrency)}/USDT</span>
            </div>
            <div className="flex justify-between text-sm border-t border-tg-section-bg pt-2">
              <span className="text-tg-hint">Total</span>
              <span className="text-tg-text font-bold">{trade.fiatAmount.toLocaleString()} {getCurrencySymbol(trade.fiatCurrency)}</span>
            </div>
            {trade.feeAmount != null && trade.feeAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-tg-hint">Fee ({trade.feePercent ?? 0.5}%)</span>
                <span className="text-tg-hint">{trade.feeAmount.toFixed(2)} USDT</span>
              </div>
            )}
          </div>

          {/* Rating */}
          {!rated ? (
            <div>
              <p className="text-tg-text text-sm font-semibold text-center mb-2">
                Rate your counterparty
              </p>
              <StarRating rating={rating} onRate={handleRate} />
            </div>
          ) : (
            <p className="text-tg-hint text-sm text-center">
              Thanks for your rating!
            </p>
          )}
        </div>
      )}

      {/* DISPUTED */}
      {trade.status === 'DISPUTED' && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
          <div className="text-center py-4">
            <p className="text-4xl mb-3">&#x26A0;&#xFE0F;</p>
            <p className="text-tg-text text-lg font-bold">Trade Disputed</p>
            <p className="text-tg-hint text-sm mt-2">
              This trade is under review by our support team.
              An admin will review the evidence and resolve the dispute.
            </p>
          </div>
          <div className="bg-tg-destructive/5 border border-tg-destructive/20 rounded-xl p-3 mt-3">
            <p className="text-tg-destructive text-sm">
              Do not send or receive any additional payments.
              The escrow funds are locked until this is resolved.
            </p>
          </div>
        </div>
      )}

      {/* CANCELLED or EXPIRED */}
      {(trade.status === 'CANCELLED' || trade.status === 'EXPIRED') && (
        <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
          <div className="text-center py-6">
            <p className="text-4xl mb-3">&#x274C;</p>
            <p className="text-tg-text text-lg font-bold">
              Trade {trade.status === 'CANCELLED' ? 'Cancelled' : 'Expired'}
            </p>
            <p className="text-tg-hint text-sm mt-2">
              {trade.status === 'EXPIRED'
                ? 'The escrow was not funded in time.'
                : 'This trade has been cancelled.'}
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-tg-destructive/10 rounded-xl p-3 mb-4">
          <p className="text-tg-destructive text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
