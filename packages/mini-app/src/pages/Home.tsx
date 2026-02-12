import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTonAddress } from '@tonconnect/ui-react';
import { apiCall } from '../lib/api';
import { useHaptic } from '../hooks/useHaptic';
import type { UserStats, Trade } from '../lib/types';

function SkeletonCard() {
  return (
    <div className="bg-tg-section-bg rounded-2xl p-4">
      <div className="skeleton h-4 w-24 rounded mb-3" />
      <div className="skeleton h-8 w-32 rounded mb-2" />
      <div className="skeleton h-3 w-20 rounded" />
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { impact } = useHaptic();
  const address = useTonAddress();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [address]);

  async function loadData() {
    setLoading(true);
    try {
      const [statsData, tradesData] = await Promise.allSettled([
        apiCall<UserStats>('GET', '/api/users/me/stats'),
        apiCall<Trade[]>('GET', '/api/trades?status=COMPLETED&limit=5'),
      ]);
      if (statsData.status === 'fulfilled') setStats(statsData.value);
      if (tradesData.status === 'fulfilled') setRecentTrades(tradesData.value);

      // Fetch USDT balance if wallet connected
      if (address) {
        try {
          const usdtMaster = import.meta.env.VITE_USDT_MASTER;
          if (usdtMaster) {
            const res = await fetch(
              `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/jettons/${encodeURIComponent(usdtMaster)}`
            );
            if (res.ok) {
              const data = await res.json();
              const raw = BigInt(data.balance || '0');
              setBalance((Number(raw) / 1_000_000).toFixed(2));
            }
          }
        } catch {
          // Balance fetch failed
        }
      }
    } catch {
      // Stats fetch failed
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-4 py-4 animate-fade-in">
      {/* Balance Card */}
      <div className="bg-tg-section-bg rounded-2xl p-5 mb-4">
        <p className="text-tg-hint text-sm mb-1">USDT Balance</p>
        {loading ? (
          <div className="skeleton h-9 w-40 rounded" />
        ) : (
          <p className="text-tg-text text-3xl font-bold">
            {balance !== null ? `$${balance}` : address ? '$--' : 'Connect Wallet'}
          </p>
        )}
        {!address && (
          <p className="text-tg-hint text-xs mt-2">
            Connect your TON wallet to see balance
          </p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => { impact('medium'); navigate('/create?type=BUY'); }}
          className="bg-[#22c55e] text-white rounded-2xl p-4 text-center active:scale-95 transition-transform"
        >
          <span className="text-2xl block mb-1">&#x1F4B0;</span>
          <span className="font-semibold text-base">Buy USDT</span>
          <span className="text-xs opacity-80 block mt-0.5">Purchase with TTD</span>
        </button>
        <button
          onClick={() => { impact('medium'); navigate('/create?type=SELL'); }}
          className="bg-tg-button text-tg-button-text rounded-2xl p-4 text-center active:scale-95 transition-transform"
        >
          <span className="text-2xl block mb-1">&#x1F4B8;</span>
          <span className="font-semibold text-base">Sell USDT</span>
          <span className="text-xs opacity-80 block mt-0.5">Convert to TTD</span>
        </button>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-tg-section-bg rounded-2xl p-4">
            <p className="text-tg-hint text-xs">Active Orders</p>
            <p className="text-tg-text text-2xl font-bold">{stats.activeOrders}</p>
          </div>
          <div className="bg-tg-section-bg rounded-2xl p-4">
            <p className="text-tg-hint text-xs">Pending Trades</p>
            <p className="text-tg-text text-2xl font-bold">{stats.pendingTrades}</p>
          </div>
          <div className="bg-tg-section-bg rounded-2xl p-4">
            <p className="text-tg-hint text-xs">Completed</p>
            <p className="text-tg-text text-2xl font-bold">{stats.completedTrades}</p>
          </div>
          <div className="bg-tg-section-bg rounded-2xl p-4">
            <p className="text-tg-hint text-xs">Reputation</p>
            <p className="text-tg-text text-2xl font-bold">
              {stats.reputationScore > 0 ? stats.reputationScore.toFixed(1) : '--'}
            </p>
          </div>
        </div>
      ) : null}

      {/* Browse Orders Button */}
      <button
        onClick={() => navigate('/orders')}
        className="w-full bg-tg-section-bg rounded-2xl p-4 flex items-center justify-between mb-4 active:bg-tg-secondary-bg transition-colors"
      >
        <div>
          <p className="text-tg-text font-semibold">Browse Order Book</p>
          <p className="text-tg-hint text-sm">Find the best rates</p>
        </div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tg-theme-hint-color)" strokeWidth="2">
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>

      {/* Recent Trades */}
      <div className="bg-tg-section-bg rounded-2xl p-4">
        <h3 className="text-tg-text font-semibold mb-3">Recent Trades</h3>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex justify-between">
                <div className="skeleton h-4 w-24 rounded" />
                <div className="skeleton h-4 w-16 rounded" />
              </div>
            ))}
          </div>
        ) : recentTrades.length > 0 ? (
          <div className="space-y-3">
            {recentTrades.map(trade => (
              <div
                key={trade.id}
                className="flex items-center justify-between py-2 border-b border-tg-secondary-bg last:border-0"
              >
                <div>
                  <p className="text-tg-text text-sm font-medium">
                    {trade.amount} USDT
                  </p>
                  <p className="text-tg-hint text-xs">
                    @ {trade.pricePerUsdt} TTD
                  </p>
                </div>
                <span className="text-xs bg-[#22c55e]/10 text-[#22c55e] px-2 py-1 rounded-full">
                  Completed
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-tg-hint text-3xl mb-2">&#x1F4CA;</p>
            <p className="text-tg-hint text-sm">No recent trades yet</p>
            <p className="text-tg-hint text-xs mt-1">Completed trades will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
