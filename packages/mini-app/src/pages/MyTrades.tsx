import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { useHaptic } from '../hooks/useHaptic';
import { getCurrencySymbol } from '../lib/currencies';
import type { Trade, TradeStatus } from '../lib/types';

type Tab = 'active' | 'completed' | 'disputed';

const TAB_FILTERS: Record<Tab, TradeStatus[]> = {
  active: ['AWAITING_ESCROW', 'ESCROW_LOCKED', 'FIAT_SENT'],
  completed: ['COMPLETED'],
  disputed: ['DISPUTED', 'CANCELLED', 'EXPIRED'],
};

function getStatusColor(status: TradeStatus): string {
  switch (status) {
    case 'AWAITING_ESCROW': return 'bg-yellow-500/10 text-yellow-600';
    case 'ESCROW_LOCKED': return 'bg-blue-500/10 text-blue-600';
    case 'FIAT_SENT': return 'bg-purple-500/10 text-purple-600';
    case 'COMPLETED': return 'bg-[#22c55e]/10 text-[#22c55e]';
    case 'DISPUTED': return 'bg-tg-destructive/10 text-tg-destructive';
    case 'CANCELLED': return 'bg-tg-hint/10 text-tg-hint';
    case 'EXPIRED': return 'bg-tg-hint/10 text-tg-hint';
    default: return 'bg-tg-hint/10 text-tg-hint';
  }
}

function getStatusLabel(status: TradeStatus): string {
  return status.replace(/_/g, ' ');
}

function TradeSkeleton() {
  return (
    <div className="bg-tg-section-bg rounded-2xl p-4 mb-3">
      <div className="flex justify-between mb-3">
        <div className="skeleton h-5 w-28 rounded" />
        <div className="skeleton h-5 w-24 rounded-full" />
      </div>
      <div className="skeleton h-4 w-40 rounded mb-2" />
      <div className="skeleton h-3 w-32 rounded" />
    </div>
  );
}

export default function MyTrades() {
  const navigate = useNavigate();
  const { impact } = useHaptic();
  const [tab, setTab] = useState<Tab>('active');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall<Trade[]>('GET', '/api/trades');
      const statuses = TAB_FILTERS[tab];
      setTrades(data.filter(t => statuses.includes(t.status)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trades');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const filteredTrades = trades;

  return (
    <div className="px-4 py-4 animate-fade-in">
      <h2 className="text-tg-text text-lg font-bold mb-4">My Trades</h2>

      {/* Tab Selector */}
      <div className="flex bg-tg-section-bg rounded-xl p-1 mb-4">
        {([
          { key: 'active' as Tab, label: 'Active' },
          { key: 'completed' as Tab, label: 'Completed' },
          { key: 'disputed' as Tab, label: 'Disputed' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); impact('light'); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'bg-tg-button text-tg-button-text'
                : 'text-tg-hint'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Trade List */}
      {loading ? (
        <div>
          {[1, 2, 3].map(i => <TradeSkeleton key={i} />)}
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-tg-destructive mb-3">{error}</p>
          <button
            onClick={fetchTrades}
            className="bg-tg-button text-tg-button-text px-6 py-2 rounded-xl text-sm"
          >
            Retry
          </button>
        </div>
      ) : filteredTrades.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">
            {tab === 'active' ? '\uD83D\uDCC8' : tab === 'completed' ? '\uD83C\uDFC6' : '\uD83D\uDCCB'}
          </p>
          <p className="text-tg-text font-semibold">
            {tab === 'active' ? 'No active trades' :
             tab === 'completed' ? 'No completed trades' :
             'No disputed trades'}
          </p>
          <p className="text-tg-hint text-sm mt-1">
            {tab === 'active'
              ? 'Accept an order to start trading'
              : 'Your trades will appear here'}
          </p>
          {tab === 'active' && (
            <button
              onClick={() => navigate('/')}
              className="bg-tg-button text-tg-button-text px-6 py-2 rounded-xl text-sm mt-4"
            >
              Browse Orders
            </button>
          )}
        </div>
      ) : (
        <div>
          {filteredTrades.map(trade => (
            <button
              key={trade.id}
              onClick={() => { impact('light'); navigate(`/trade/${trade.id}`); }}
              className="w-full bg-tg-section-bg rounded-2xl p-4 mb-3 text-left active:bg-tg-secondary-bg transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-tg-text font-semibold">
                  {trade.amount} USDT
                </span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(trade.status)}`}>
                  {getStatusLabel(trade.status)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-tg-hint text-sm">
                  @ {trade.pricePerUsdt} {getCurrencySymbol(trade.fiatCurrency)} = {trade.fiatAmount.toLocaleString()} {getCurrencySymbol(trade.fiatCurrency)}
                </span>
                <span className="text-tg-hint text-xs">
                  {new Date(trade.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {trade.paymentReference && (
                <p className="text-tg-accent text-xs mt-1 font-mono">
                  Ref: {trade.paymentReference}
                </p>
              )}
            </button>
          ))}

          <button
            onClick={fetchTrades}
            className="w-full text-center text-tg-link text-sm py-3"
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
