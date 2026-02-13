import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';
import { useHaptic } from '../hooks/useHaptic';
import { getCurrencySymbol } from '../lib/currencies';
import type { AdminStats, DisputeInfo, UserProfile, Order, Trade } from '../lib/types';

type AdminTab = 'disputes' | 'users' | 'orders' | 'stats';

// --- Disputes Tab ---
function DisputesPanel() {
  const { impact, notification } = useHaptic();
  const [disputes, setDisputes] = useState<(DisputeInfo & { trade?: Trade })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [banBuyer, setBanBuyer] = useState(false);
  const [banSeller, setBanSeller] = useState(false);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<(DisputeInfo & { trade?: Trade })[]>('GET', '/api/admin/disputes');
      // Sort: open disputes first
      data.sort((a, b) => {
        if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
        if (a.status !== 'OPEN' && b.status === 'OPEN') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setDisputes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load disputes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const resolveDispute = async (disputeId: string, resolution: 'release' | 'refund' | 'dismiss') => {
    impact('heavy');
    setActionLoading(true);
    try {
      await apiCall('POST', `/api/admin/disputes/${disputeId}/resolve`, {
        resolution,
        banBuyer,
        banSeller,
        banReason: (banBuyer || banSeller) ? banReason : undefined,
      });
      notification('success');
      setBanBuyer(false);
      setBanSeller(false);
      setBanReason('');
      fetchDisputes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resolve dispute');
      notification('error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="bg-tg-section-bg rounded-2xl p-4"><div className="skeleton h-5 w-40 rounded mb-2" /><div className="skeleton h-4 w-60 rounded" /></div>)}</div>;
  if (error) return <div className="text-center py-8"><p className="text-tg-destructive text-sm mb-3">{error}</p><button onClick={fetchDisputes} className="bg-tg-button text-tg-button-text px-4 py-2 rounded-xl text-sm">Retry</button></div>;

  return (
    <div>
      {disputes.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-tg-hint text-sm">No disputes found</p>
        </div>
      ) : disputes.map(dispute => (
        <div key={dispute.id} className="bg-tg-section-bg rounded-2xl mb-3 overflow-hidden">
          <button
            onClick={() => { setExpandedId(expandedId === dispute.id ? null : dispute.id); impact('light'); }}
            className="w-full p-4 text-left"
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-tg-text text-sm font-semibold">
                Dispute #{dispute.id.slice(-6).toUpperCase()}
              </p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                dispute.status === 'OPEN' ? 'bg-tg-destructive/10 text-tg-destructive' : 'bg-[#22c55e]/10 text-[#22c55e]'
              }`}>
                {dispute.status}
              </span>
            </div>
            <p className="text-tg-hint text-xs">{dispute.reason}</p>
            <p className="text-tg-hint text-[10px] mt-1">
              {new Date(dispute.createdAt).toLocaleDateString()}
            </p>
          </button>

          {expandedId === dispute.id && (
            <div className="px-4 pb-4 border-t border-tg-secondary-bg pt-3 animate-fade-in space-y-3">
              <div>
                <p className="text-tg-hint text-xs mb-1">Description</p>
                <p className="text-tg-text text-sm bg-tg-secondary-bg rounded-lg p-2">{dispute.description}</p>
              </div>

              {dispute.trade && (
                <div className="bg-tg-secondary-bg rounded-xl p-3 space-y-1.5">
                  <p className="text-tg-hint text-xs font-semibold">Trade Info</p>
                  <p className="text-tg-text text-xs">Amount: {dispute.trade.amount} USDT</p>
                  <p className="text-tg-text text-xs">Fiat: {dispute.trade.fiatAmount} {getCurrencySymbol(dispute.trade.fiatCurrency)}</p>
                  <p className="text-tg-text text-xs">Status: {dispute.trade.status}</p>
                  <p className="text-tg-text text-xs">Buyer: {dispute.trade.buyer?.username || dispute.trade.buyerId.slice(-6)}</p>
                  <p className="text-tg-text text-xs">Seller: {dispute.trade.seller?.username || dispute.trade.sellerId.slice(-6)}</p>
                </div>
              )}

              {dispute.status === 'OPEN' && (
                <>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-tg-text">
                      <input
                        type="checkbox"
                        checked={banBuyer}
                        onChange={e => setBanBuyer(e.target.checked)}
                        className="w-4 h-4"
                      />
                      Ban buyer
                    </label>
                    <label className="flex items-center gap-2 text-sm text-tg-text">
                      <input
                        type="checkbox"
                        checked={banSeller}
                        onChange={e => setBanSeller(e.target.checked)}
                        className="w-4 h-4"
                      />
                      Ban seller
                    </label>
                    {(banBuyer || banSeller) && (
                      <input
                        type="text"
                        value={banReason}
                        onChange={e => setBanReason(e.target.value)}
                        placeholder="Ban reason..."
                        className="w-full bg-tg-secondary-bg text-tg-text text-sm rounded-lg p-2 outline-none"
                      />
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => resolveDispute(dispute.id, 'release')}
                      disabled={actionLoading}
                      className="flex-1 bg-[#22c55e] text-white py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50"
                    >
                      Release to Buyer
                    </button>
                    <button
                      onClick={() => resolveDispute(dispute.id, 'refund')}
                      disabled={actionLoading}
                      className="flex-1 bg-tg-accent text-white py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50"
                    >
                      Return to Seller
                    </button>
                    <button
                      onClick={() => resolveDispute(dispute.id, 'dismiss')}
                      disabled={actionLoading}
                      className="flex-1 bg-tg-secondary-bg text-tg-hint py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </>
              )}

              {dispute.resolvedAt && (
                <p className="text-tg-hint text-xs">
                  Resolved: {new Date(dispute.resolvedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Users Tab ---
function UsersPanel() {
  const { impact, notification } = useHaptic();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const searchUsers = useCallback(async () => {
    if (!search.trim()) { setUsers([]); return; }
    setLoading(true);
    try {
      const data = await apiCall<UserProfile[]>('GET', `/api/admin/users?search=${encodeURIComponent(search.trim())}`);
      setUsers(data);
    } catch {
      // Search failed
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(searchUsers, 500);
    return () => clearTimeout(timeout);
  }, [searchUsers]);

  const toggleBan = async (userId: string, currentlyBanned: boolean) => {
    impact('heavy');
    setActionLoading(userId);
    try {
      await apiCall('POST', `/api/admin/users/${userId}/${currentlyBanned ? 'unban' : 'ban'}`, {
        reason: 'Admin action',
      });
      notification('success');
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isBanned: !currentlyBanned } : u));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
      notification('error');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <div className="bg-tg-section-bg rounded-2xl p-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search users by name or username..."
          className="w-full bg-transparent text-tg-text text-sm outline-none placeholder-tg-hint/40"
        />
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin h-5 w-5 border-2 border-tg-button border-t-transparent rounded-full" />
        </div>
      )}

      {!loading && users.length === 0 && search.trim() && (
        <p className="text-tg-hint text-sm text-center py-4">No users found</p>
      )}

      {users.map(user => (
        <div key={user.id} className="bg-tg-section-bg rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-tg-text text-sm font-semibold">
                {user.firstName || 'Anonymous'} {user.lastName || ''}
                {user.isBanned && <span className="text-tg-destructive text-xs ml-1">(BANNED)</span>}
              </p>
              {user.username && <p className="text-tg-hint text-xs">@{user.username}</p>}
              <p className="text-tg-hint text-[10px] mt-0.5">
                {user.totalTrades} trades | Rep: {user.reputationScore.toFixed(1)} | KYC: {user.kycStatus}
              </p>
            </div>
            <button
              onClick={() => toggleBan(user.id, !!user.isBanned)}
              disabled={actionLoading === user.id}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50 ${
                user.isBanned
                  ? 'bg-[#22c55e]/10 text-[#22c55e]'
                  : 'bg-tg-destructive/10 text-tg-destructive'
              }`}
            >
              {actionLoading === user.id ? '...' : user.isBanned ? 'Unban' : 'Ban'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Orders Tab ---
function OrdersPanel() {
  const { impact, notification } = useHaptic();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<Order[]>('GET', '/api/admin/orders');
      setOrders(data);
    } catch {
      // Failed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const forceCancel = async (orderId: string) => {
    impact('heavy');
    setActionLoading(orderId);
    try {
      await apiCall('POST', `/api/admin/orders/${orderId}/cancel`);
      notification('success');
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'CANCELLED' as const } : o));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel order');
      notification('error');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="bg-tg-section-bg rounded-2xl p-4"><div className="skeleton h-5 w-40 rounded mb-2" /><div className="skeleton h-4 w-60 rounded" /></div>)}</div>;

  return (
    <div>
      {orders.length === 0 ? (
        <p className="text-tg-hint text-sm text-center py-8">No orders found</p>
      ) : orders.map(order => (
        <div key={order.id} className="bg-tg-section-bg rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-tg-text text-sm font-semibold">
              <span className={order.type === 'BUY' ? 'text-[#22c55e]' : 'text-tg-accent'}>{order.type}</span>
              {' '}{order.amount} USDT @ {order.pricePerUsdt} {getCurrencySymbol(order.currency)}
            </p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
              order.status === 'ACTIVE' ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-tg-hint/10 text-tg-hint'
            }`}>
              {order.status}
            </span>
          </div>
          <p className="text-tg-hint text-xs">
            by {order.user?.username || 'Anonymous'} | {new Date(order.createdAt).toLocaleDateString()}
          </p>
          {(order.status === 'ACTIVE' || order.status === 'PARTIALLY_MATCHED') && (
            <button
              onClick={() => forceCancel(order.id)}
              disabled={actionLoading === order.id}
              className="mt-2 text-xs text-tg-destructive bg-tg-destructive/10 px-3 py-1 rounded-lg disabled:opacity-50"
            >
              {actionLoading === order.id ? 'Cancelling...' : 'Force Cancel'}
            </button>
          )}
        </div>
      ))}
      <button onClick={fetchOrders} className="w-full text-center text-tg-link text-sm py-3">Refresh</button>
    </div>
  );
}

// --- Stats Tab ---
function StatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall<AdminStats>('GET', '/api/admin/stats')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="grid grid-cols-2 gap-3">
      {[1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} className="bg-tg-section-bg rounded-2xl p-4">
          <div className="skeleton h-3 w-16 rounded mb-2" />
          <div className="skeleton h-7 w-12 rounded" />
        </div>
      ))}
    </div>
  );

  if (!stats) return <p className="text-tg-hint text-sm text-center py-8">Failed to load stats</p>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Total Trades</p>
          <p className="text-tg-text text-2xl font-bold">{stats.totalTrades.toLocaleString()}</p>
        </div>
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Total Volume</p>
          <p className="text-tg-text text-2xl font-bold">${stats.totalVolume.toLocaleString()}</p>
        </div>
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Active Users</p>
          <p className="text-tg-text text-2xl font-bold">{stats.activeUsers.toLocaleString()}</p>
        </div>
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Open Disputes</p>
          <p className="text-tg-text text-2xl font-bold text-tg-destructive">{stats.openDisputes}</p>
        </div>
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Fees Collected</p>
          <p className="text-tg-text text-2xl font-bold">${stats.feesCollected.toLocaleString()}</p>
        </div>
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Banned Users</p>
          <p className="text-tg-text text-2xl font-bold">{stats.bannedUsers}</p>
        </div>
      </div>

      {/* Volume by Currency */}
      {stats.volumeByCurrency && Object.keys(stats.volumeByCurrency).length > 0 && (
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <h3 className="text-tg-text font-semibold mb-3">Volume by Currency</h3>
          <div className="space-y-2">
            {Object.entries(stats.volumeByCurrency).map(([code, volume]) => (
              <div key={code} className="flex justify-between text-sm">
                <span className="text-tg-hint">{code}</span>
                <span className="text-tg-text font-medium">${volume.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main Admin Page ---
export default function Admin() {
  const { impact } = useHaptic();
  const [tab, setTab] = useState<AdminTab>('disputes');
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    apiCall<AdminStats>('GET', '/api/admin/stats')
      .then(() => setAuthorized(true))
      .catch(() => setAuthorized(false));
  }, []);

  if (authorized === null) {
    return (
      <div className="px-4 py-12 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-tg-button border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-4xl mb-3">&#x1F6AB;</p>
        <p className="text-tg-text font-bold text-lg">Access Denied</p>
        <p className="text-tg-hint text-sm mt-1">You do not have admin privileges.</p>
      </div>
    );
  }

  const tabs: { key: AdminTab; label: string }[] = [
    { key: 'disputes', label: 'Disputes' },
    { key: 'users', label: 'Users' },
    { key: 'orders', label: 'Orders' },
    { key: 'stats', label: 'Stats' },
  ];

  return (
    <div className="px-4 py-4 animate-fade-in">
      <h2 className="text-tg-text text-lg font-bold mb-4">Admin Panel</h2>

      {/* Tab Selector */}
      <div className="flex bg-tg-section-bg rounded-xl p-1 mb-4">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); impact('light'); }}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === t.key
                ? 'bg-tg-button text-tg-button-text'
                : 'text-tg-hint'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'disputes' && <DisputesPanel />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'orders' && <OrdersPanel />}
      {tab === 'stats' && <StatsPanel />}
    </div>
  );
}
