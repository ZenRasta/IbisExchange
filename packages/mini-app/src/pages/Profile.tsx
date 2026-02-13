import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTonAddress } from '@tonconnect/ui-react';
import { apiCall } from '../lib/api';
import { useHaptic } from '../hooks/useHaptic';
import { CURRENCIES, CURRENCY_CODES, getCurrencySymbol } from '../lib/currencies';
import type { UserProfile, Order } from '../lib/types';

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}

function getTier(totalTrades: number, reputationScore: number): { badge: string; label: string } {
  if (totalTrades >= 100 && reputationScore >= 4.5) return { badge: '\u{1F451}', label: 'Diamond' };
  if (totalTrades >= 50 && reputationScore >= 4.0) return { badge: '\u{1F48E}', label: 'Platinum' };
  if (totalTrades >= 25 && reputationScore >= 3.5) return { badge: '\u{1F947}', label: 'Gold' };
  if (totalTrades >= 10 && reputationScore >= 3.0) return { badge: '\u{1F948}', label: 'Silver' };
  if (totalTrades >= 5) return { badge: '\u{1F949}', label: 'Bronze' };
  return { badge: '\u{1F331}', label: 'Newcomer' };
}

function getFeeTier(totalTrades: number): { percent: number; label: string } {
  if (totalTrades >= 100) return { percent: 0.1, label: 'VIP' };
  if (totalTrades >= 50) return { percent: 0.2, label: 'Platinum' };
  if (totalTrades >= 25) return { percent: 0.3, label: 'Gold' };
  if (totalTrades >= 10) return { percent: 0.4, label: 'Silver' };
  return { percent: 0.5, label: 'Standard' };
}

export default function Profile() {
  const navigate = useNavigate();
  const { impact, notification } = useHaptic();
  const address = useTonAddress();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    setLoading(true);
    try {
      const [profileData, ordersData] = await Promise.allSettled([
        apiCall<UserProfile>('GET', '/api/users/me'),
        apiCall<Order[]>('GET', '/api/orders?mine=true&status=ACTIVE'),
      ]);
      if (profileData.status === 'fulfilled') setProfile(profileData.value);
      if (ordersData.status === 'fulfilled') setOrders(ordersData.value);
    } catch {
      // Failed to load
    } finally {
      setLoading(false);
    }
  }

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      impact('light');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    impact('medium');
    try {
      await apiCall('DELETE', `/api/orders/${orderId}`);
      notification('success');
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (err) {
      notification('error');
      alert(err instanceof Error ? err.message : 'Failed to cancel order');
    }
  };

  const handleCurrencyChange = async (currency: string) => {
    impact('light');
    setSavingCurrency(true);
    try {
      await apiCall('PUT', '/api/users/me', { preferredCurrency: currency });
      setProfile(prev => prev ? { ...prev, preferredCurrency: currency } : prev);
      notification('success');
    } catch {
      notification('error');
    } finally {
      setSavingCurrency(false);
    }
  };

  const kycLabel = (() => {
    if (!profile) return '';
    switch (profile.kycStatus) {
      case 'VERIFIED': return 'Verified';
      case 'PENDING': return 'Pending Review';
      case 'ACTION_REQUIRED': return 'Action Required';
      case 'REJECTED': return 'Declined';
      default: return 'Unverified';
    }
  })();

  const kycColor = (() => {
    if (!profile) return '';
    switch (profile.kycStatus) {
      case 'VERIFIED': return 'bg-[#22c55e]/10 text-[#22c55e]';
      case 'PENDING': return 'bg-yellow-500/10 text-yellow-600';
      case 'ACTION_REQUIRED': return 'bg-yellow-500/10 text-yellow-600';
      case 'REJECTED': return 'bg-tg-destructive/10 text-tg-destructive';
      default: return 'bg-tg-hint/10 text-tg-hint';
    }
  })();

  const tier = profile ? getTier(profile.totalTrades, profile.reputationScore) : null;
  const feeTier = profile ? getFeeTier(profile.totalTrades) : null;

  if (loading) {
    return (
      <div className="px-4 py-4">
        <div className="bg-tg-section-bg rounded-2xl p-6 mb-4">
          <div className="flex items-center gap-4 mb-4">
            <div className="skeleton w-16 h-16 rounded-full" />
            <div>
              <div className="skeleton h-5 w-32 rounded mb-2" />
              <div className="skeleton h-4 w-24 rounded" />
            </div>
          </div>
          <div className="skeleton h-10 w-full rounded-xl" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-tg-section-bg rounded-2xl p-4">
              <div className="skeleton h-3 w-16 rounded mb-2" />
              <div className="skeleton h-7 w-12 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 animate-fade-in">
      {/* Profile Card */}
      <div className="bg-tg-section-bg rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-4 mb-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-tg-button/20 flex items-center justify-center">
            <span className="text-tg-text text-2xl font-bold">
              {(profile?.firstName || profile?.username || '?')[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1">
            <h2 className="text-tg-text font-bold text-lg">
              {profile?.firstName || 'Anonymous'}
              {profile?.lastName ? ` ${profile.lastName}` : ''}
            </h2>
            {profile?.username && (
              <p className="text-tg-hint text-sm">@{profile.username}</p>
            )}
            {tier && (
              <p className="text-xs mt-0.5">
                {tier.badge} {tier.label}
              </p>
            )}
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${kycColor}`}>
            {kycLabel}
          </span>
        </div>

        {/* Wallet Address */}
        {address ? (
          <button
            onClick={handleCopyAddress}
            className="w-full flex items-center justify-between bg-tg-secondary-bg rounded-xl p-3"
          >
            <div>
              <p className="text-tg-hint text-xs">Connected Wallet</p>
              <p className="text-tg-text text-sm font-mono">{truncateAddress(address)}</p>
            </div>
            <span className="text-tg-hint text-xs">
              {copied ? 'Copied!' : 'Copy'}
            </span>
          </button>
        ) : (
          <div className="bg-tg-secondary-bg rounded-xl p-3 text-center">
            <p className="text-tg-hint text-sm">No wallet connected</p>
            <p className="text-tg-hint text-xs mt-0.5">
              Connect via the button in the header
            </p>
          </div>
        )}
      </div>

      {/* KYC Banner */}
      {profile && profile.kycStatus !== 'VERIFIED' && (
        <button
          onClick={() => { impact('medium'); navigate('/kyc'); }}
          className="w-full bg-tg-button/10 border border-tg-button/30 rounded-2xl p-4 mb-4 text-left active:bg-tg-button/20 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-tg-text font-semibold">
                {profile.kycStatus === 'PENDING' ? 'Verification in Progress'
                  : profile.kycStatus === 'ACTION_REQUIRED' ? 'Action Required'
                  : profile.kycStatus === 'REJECTED' ? 'Verification Declined'
                  : 'Get Verified'}
              </p>
              <p className="text-tg-hint text-sm mt-0.5">
                {profile.kycStatus === 'PENDING'
                  ? 'Your documents are being reviewed'
                  : profile.kycStatus === 'ACTION_REQUIRED'
                  ? 'Please resubmit your documents'
                  : profile.kycStatus === 'REJECTED'
                  ? 'Try again with valid documents'
                  : 'Unlock higher trade limits with KYC verification'}
              </p>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tg-theme-button-color)" strokeWidth="2">
              <polyline points="9,18 15,12 9,6" />
            </svg>
          </div>
        </button>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Trades Completed</p>
          <p className="text-tg-text text-2xl font-bold">{profile?.totalTrades ?? 0}</p>
        </div>
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Success Rate</p>
          <p className="text-tg-text text-2xl font-bold">
            {profile && profile.totalTrades > 0 ? `${((profile.successfulTrades / profile.totalTrades) * 100).toFixed(0)}%` : '--'}
          </p>
        </div>
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Total Volume</p>
          <p className="text-tg-text text-2xl font-bold">
            {profile?.totalVolume ? `$${profile.totalVolume.toLocaleString()}` : '$0'}
          </p>
        </div>
        <div className="bg-tg-section-bg rounded-2xl p-4">
          <p className="text-tg-hint text-xs">Reputation</p>
          <p className="text-tg-text text-2xl font-bold">
            {profile?.reputationScore ? profile.reputationScore.toFixed(1) : '--'}
          </p>
        </div>
      </div>

      {/* Votes & Tier Info */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
        <h3 className="text-tg-text font-semibold mb-3">Community Standing</h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-tg-hint">Upvotes</span>
            <span className="text-[#22c55e] font-medium">+{profile?.totalUpvotes ?? 0}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-tg-hint">Downvotes</span>
            <span className="text-tg-destructive font-medium">-{profile?.totalDownvotes ?? 0}</span>
          </div>
          {tier && (
            <div className="flex justify-between text-sm border-t border-tg-secondary-bg pt-2">
              <span className="text-tg-hint">Tier</span>
              <span className="text-tg-text font-medium">{tier.badge} {tier.label}</span>
            </div>
          )}
          {feeTier && (
            <div className="flex justify-between text-sm">
              <span className="text-tg-hint">Fee Rate</span>
              <span className="text-tg-text font-medium">{feeTier.percent}% ({feeTier.label})</span>
            </div>
          )}
        </div>
      </div>

      {/* Preferred Currency */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
        <h3 className="text-tg-text font-semibold mb-3">Preferred Currency</h3>
        <div className="flex overflow-x-auto no-scrollbar gap-1.5 -mx-1 px-1">
          {CURRENCY_CODES.map(code => {
            const info = CURRENCIES[code];
            const isActive = (profile?.preferredCurrency || 'TTD') === code;
            return (
              <button
                key={code}
                onClick={() => handleCurrencyChange(code)}
                disabled={savingCurrency}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0 disabled:opacity-50 ${
                  isActive
                    ? 'bg-tg-button text-tg-button-text'
                    : 'bg-tg-secondary-bg text-tg-hint'
                }`}
              >
                <span>{info.flag}</span>
                <span>{code}</span>
              </button>
            );
          })}
        </div>
        <p className="text-tg-hint text-xs mt-2">
          Used as the default currency when browsing orders
        </p>
      </div>

      {/* Trade Limits */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
        <h3 className="text-tg-text font-semibold mb-2">Trade Limits</h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-tg-hint">Max per trade</span>
            <span className="text-tg-text font-medium">
              {profile?.kycStatus === 'VERIFIED' ? '5,000 USDT' : '500 USDT'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-tg-hint">Daily limit</span>
            <span className="text-tg-text font-medium">
              {profile?.kycStatus === 'VERIFIED' ? '10,000 USDT' : '1,000 USDT'}
            </span>
          </div>
          {profile?.kycStatus !== 'VERIFIED' && (
            <p className="text-tg-accent text-xs mt-1">
              Complete KYC to increase limits
            </p>
          )}
        </div>
      </div>

      {/* My Active Orders */}
      <div className="bg-tg-section-bg rounded-2xl p-4 mb-4">
        <h3 className="text-tg-text font-semibold mb-3">My Active Orders</h3>
        {orders.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-tg-hint text-sm">No active orders</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map(order => (
              <div
                key={order.id}
                className="flex items-center justify-between bg-tg-secondary-bg rounded-xl p-3"
              >
                <div>
                  <p className="text-tg-text text-sm font-medium">
                    <span className={order.type === 'BUY' ? 'text-[#22c55e]' : 'text-tg-accent'}>
                      {order.type}
                    </span>
                    {' '}{order.amount} USDT
                  </p>
                  <p className="text-tg-hint text-xs">@ {order.pricePerUsdt} {getCurrencySymbol(order.currency)}</p>
                </div>
                <button
                  onClick={() => handleCancelOrder(order.id)}
                  className="text-tg-destructive text-xs px-3 py-1.5 rounded-lg bg-tg-destructive/10"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Admin Link */}
      {profile?.isAdmin && (
        <button
          onClick={() => { impact('medium'); navigate('/admin'); }}
          className="w-full bg-tg-section-bg rounded-2xl p-4 mb-4 flex items-center justify-between active:bg-tg-secondary-bg transition-colors"
        >
          <div>
            <p className="text-tg-text font-semibold">Admin Panel</p>
            <p className="text-tg-hint text-sm">Manage disputes, users & orders</p>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tg-theme-hint-color)" strokeWidth="2">
            <polyline points="9,18 15,12 9,6" />
          </svg>
        </button>
      )}
    </div>
  );
}
