import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { useHaptic } from '../hooks/useHaptic';
import type { Order } from '../lib/types';

type SortOption = 'price_asc' | 'price_desc' | 'reputation' | 'newest';
type Tab = 'BUY' | 'SELL';

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

function OrderSkeleton() {
  return (
    <div className="bg-tg-section-bg rounded-2xl p-4 mb-3 animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="skeleton h-5 w-32 rounded" />
        <div className="skeleton h-5 w-20 rounded" />
      </div>
      <div className="skeleton h-4 w-48 rounded mb-2" />
      <div className="skeleton h-4 w-24 rounded" />
    </div>
  );
}

export default function OrderBook() {
  const navigate = useNavigate();
  const { impact } = useHaptic();
  const [tab, setTab] = useState<Tab>('SELL');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>('price_asc');
  const [filterMethod, setFilterMethod] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ type: tab, sort });
      if (filterMethod) params.set('paymentMethod', filterMethod);
      const data = await apiCall<Order[]>('GET', `/api/orders?${params.toString()}`);
      setOrders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, sort, filterMethod]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleAcceptOrder = async (orderId: string) => {
    impact('heavy');
    try {
      const trade = await apiCall<{ id: string }>('POST', '/api/trades', { orderId });
      navigate(`/trade/${trade.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to accept order');
    }
  };

  const sortedOrders = [...orders].sort((a, b) => {
    switch (sort) {
      case 'price_asc': return a.pricePerUsdt - b.pricePerUsdt;
      case 'price_desc': return b.pricePerUsdt - a.pricePerUsdt;
      case 'reputation': return (b.user?.reputationScore ?? 0) - (a.user?.reputationScore ?? 0);
      case 'newest': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      default: return 0;
    }
  });

  return (
    <div className="px-4 py-4 animate-fade-in">
      {/* Tab Selector */}
      <div className="flex bg-tg-section-bg rounded-xl p-1 mb-4">
        {(['BUY', 'SELL'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setExpandedId(null); impact('light'); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t
                ? 'bg-tg-button text-tg-button-text'
                : 'text-tg-hint'
            }`}
          >
            {t === 'BUY' ? 'Buyers' : 'Sellers'}
          </button>
        ))}
      </div>

      {/* Sort & Filter */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortOption)}
          className="bg-tg-section-bg text-tg-text text-xs px-3 py-2 rounded-lg border-none outline-none"
        >
          <option value="price_asc">Best Price</option>
          <option value="price_desc">Highest Price</option>
          <option value="reputation">Top Reputation</option>
          <option value="newest">Newest</option>
        </select>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`text-xs px-3 py-2 rounded-lg whitespace-nowrap ${
            filterMethod
              ? 'bg-tg-button text-tg-button-text'
              : 'bg-tg-section-bg text-tg-hint'
          }`}
        >
          {filterMethod || 'Filter Payment'}
        </button>
        {filterMethod && (
          <button
            onClick={() => setFilterMethod(null)}
            className="text-xs text-tg-destructive px-2 py-2"
          >
            Clear
          </button>
        )}
      </div>

      {/* Payment Method Filter Chips */}
      {showFilters && (
        <div className="flex flex-wrap gap-2 mb-4 animate-fade-in">
          {PAYMENT_METHODS.map(method => (
            <button
              key={method}
              onClick={() => {
                setFilterMethod(filterMethod === method ? null : method);
                setShowFilters(false);
              }}
              className={`text-xs px-3 py-1.5 rounded-full ${
                filterMethod === method
                  ? 'bg-tg-button text-tg-button-text'
                  : 'bg-tg-section-bg text-tg-text'
              }`}
            >
              {method}
            </button>
          ))}
        </div>
      )}

      {/* Pull to Refresh Indicator */}
      {refreshing && (
        <div className="flex justify-center mb-3">
          <div className="animate-spin h-5 w-5 border-2 border-tg-button border-t-transparent rounded-full" />
        </div>
      )}

      {/* Orders List */}
      {loading ? (
        <div>
          {[1, 2, 3, 4].map(i => <OrderSkeleton key={i} />)}
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-tg-destructive mb-3">{error}</p>
          <button
            onClick={() => fetchOrders()}
            className="bg-tg-button text-tg-button-text px-6 py-2 rounded-xl text-sm"
          >
            Retry
          </button>
        </div>
      ) : sortedOrders.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">&#x1F4CB;</p>
          <p className="text-tg-text font-semibold">No orders yet</p>
          <p className="text-tg-hint text-sm mt-1">
            Be the first to create a {tab.toLowerCase()} order
          </p>
          <button
            onClick={() => navigate(`/create?type=${tab}`)}
            className="bg-tg-button text-tg-button-text px-6 py-2 rounded-xl text-sm mt-4"
          >
            Create Order
          </button>
        </div>
      ) : (
        <div>
          {sortedOrders.map(order => (
            <div
              key={order.id}
              className="bg-tg-section-bg rounded-2xl mb-3 overflow-hidden"
            >
              <button
                onClick={() => {
                  setExpandedId(expandedId === order.id ? null : order.id);
                  impact('light');
                }}
                className="w-full p-4 text-left"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-tg-button/20 flex items-center justify-center">
                      <span className="text-tg-text text-sm font-bold">
                        {(order.user?.firstName || order.user?.username || '?')[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-tg-text text-sm font-semibold">
                        {order.user?.username || 'Anonymous'}
                        {order.user?.kycStatus === 'VERIFIED' && (
                          <span className="ml-1 text-xs" title="Verified">&#x2705;</span>
                        )}
                      </p>
                      <p className="text-tg-hint text-xs">
                        {order.user?.totalTrades ?? 0} trades | {order.user?.reputationScore?.toFixed(1) ?? '--'} rep
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-tg-text font-bold">{order.amount} USDT</p>
                    <p className="text-tg-accent text-sm font-semibold">{order.pricePerUsdt} TTD</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-tg-hint text-xs">
                    Total: <span className="text-tg-text">{(order.remainingAmount * order.pricePerUsdt).toLocaleString()} TTD</span>
                  </p>
                  <div className="flex gap-1">
                    {order.paymentMethods.slice(0, 2).map(m => (
                      <span key={m} className="text-[10px] bg-tg-secondary-bg text-tg-hint px-2 py-0.5 rounded-full">
                        {m}
                      </span>
                    ))}
                    {order.paymentMethods.length > 2 && (
                      <span className="text-[10px] bg-tg-secondary-bg text-tg-hint px-2 py-0.5 rounded-full">
                        +{order.paymentMethods.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded Details */}
              {expandedId === order.id && (
                <div className="px-4 pb-4 border-t border-tg-secondary-bg pt-3 animate-fade-in">
                  {order.bankDetails && (
                    <div className="mb-3">
                      <p className="text-tg-hint text-xs mb-1">Bank Details</p>
                      <p className="text-tg-text text-sm bg-tg-secondary-bg rounded-lg p-2">
                        {order.bankDetails}
                      </p>
                    </div>
                  )}
                  <div className="mb-3">
                    <p className="text-tg-hint text-xs mb-1">Payment Methods</p>
                    <div className="flex flex-wrap gap-1">
                      {order.paymentMethods.map(m => (
                        <span key={m} className="text-xs bg-tg-secondary-bg text-tg-text px-2 py-1 rounded-full">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleAcceptOrder(order.id)}
                    className="w-full bg-tg-button text-tg-button-text py-3 rounded-xl font-semibold active:scale-[0.98] transition-transform"
                  >
                    Accept - {tab === 'SELL' ? 'Buy' : 'Sell'} {order.amount} USDT
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Refresh button */}
          <button
            onClick={() => fetchOrders(true)}
            className="w-full text-center text-tg-link text-sm py-3"
          >
            Refresh Orders
          </button>
        </div>
      )}
    </div>
  );
}
