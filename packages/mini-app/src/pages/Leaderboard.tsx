import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../lib/api';
import { useHaptic } from '../hooks/useHaptic';
import type { LeaderboardUser } from '../lib/types';

type SortOption = 'reputation' | 'trades' | 'volume' | 'newest';

function UserSkeleton() {
  return (
    <div className="bg-tg-section-bg rounded-2xl p-4 mb-3">
      <div className="flex items-center gap-3">
        <div className="skeleton w-10 h-10 rounded-full" />
        <div className="flex-1">
          <div className="skeleton h-4 w-28 rounded mb-2" />
          <div className="skeleton h-3 w-40 rounded" />
        </div>
        <div className="skeleton h-6 w-16 rounded" />
      </div>
    </div>
  );
}

function UserDetailModal({ user, onClose }: { user: LeaderboardUser; onClose: () => void }) {
  const navigate = useNavigate();
  const { impact } = useHaptic();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-tg-bg rounded-t-2xl w-full max-w-lg animate-slide-up p-5 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-tg-hint/30 rounded-full mx-auto mb-4" />

        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-full bg-tg-button/20 flex items-center justify-center">
            <span className="text-tg-text text-2xl font-bold">
              {user.firstName[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1">
            <h3 className="text-tg-text font-bold text-lg">
              {user.firstName}
              {user.kycStatus === 'VERIFIED' && (
                <span className="ml-1 text-sm" title="Verified">&#x2705;</span>
              )}
            </h3>
            {user.username && (
              <p className="text-tg-hint text-sm">@{user.username}</p>
            )}
            <span className="text-xs mt-0.5 inline-block">{user.reputationTier?.badge} {user.reputationTier?.label}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-tg-secondary-bg rounded-xl p-3">
            <p className="text-tg-hint text-xs">Reputation</p>
            <p className="text-tg-text text-lg font-bold">{user.reputationScore.toFixed(1)}</p>
          </div>
          <div className="bg-tg-secondary-bg rounded-xl p-3">
            <p className="text-tg-hint text-xs">Total Trades</p>
            <p className="text-tg-text text-lg font-bold">{user.totalTrades}</p>
          </div>
          <div className="bg-tg-secondary-bg rounded-xl p-3">
            <p className="text-tg-hint text-xs">Volume</p>
            <p className="text-tg-text text-lg font-bold">${user.totalVolume.toLocaleString()}</p>
          </div>
          <div className="bg-tg-secondary-bg rounded-xl p-3">
            <p className="text-tg-hint text-xs">Votes</p>
            <p className="text-tg-text text-lg font-bold">
              <span className="text-[#22c55e]">+{user.totalUpvotes}</span>
              {' / '}
              <span className="text-tg-destructive">-{user.totalDownvotes}</span>
            </p>
          </div>
        </div>

        <p className="text-tg-hint text-xs mb-4">
          Member since {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>

        <button
          onClick={() => { impact('medium'); onClose(); navigate('/orders'); }}
          className="w-full bg-tg-button text-tg-button-text py-3 rounded-xl font-semibold active:scale-[0.98] transition-transform"
        >
          Trade with this user
        </button>
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const { impact } = useHaptic();
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>('reputation');
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<LeaderboardUser | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchUsers = useCallback(async (pageNum: number, isLoadMore = false) => {
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        sort,
        page: pageNum.toString(),
        limit: '20',
      });
      if (search.trim()) params.set('search', search.trim());
      const data = await apiCall<LeaderboardUser[]>('GET', `/api/users/leaderboard?${params.toString()}`);

      if (isLoadMore) {
        setUsers(prev => [...prev, ...data]);
      } else {
        setUsers(data);
      }
      setHasMore(data.length === 20);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort, search]);

  useEffect(() => {
    setPage(1);
    fetchUsers(1);
  }, [fetchUsers]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchUsers(nextPage, true);
  };

  const getRankDisplay = (index: number) => {
    if (index === 0) return { label: '1st', style: 'bg-yellow-500/20 text-yellow-600' };
    if (index === 1) return { label: '2nd', style: 'bg-gray-300/20 text-gray-500' };
    if (index === 2) return { label: '3rd', style: 'bg-amber-700/20 text-amber-700' };
    return { label: `#${index + 1}`, style: 'bg-tg-secondary-bg text-tg-hint' };
  };

  return (
    <div className="px-4 py-4 animate-fade-in">
      <h2 className="text-tg-text text-lg font-bold mb-4">Trader Leaderboard</h2>

      {/* Search */}
      <div className="bg-tg-section-bg rounded-2xl p-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by username..."
          className="w-full bg-transparent text-tg-text text-sm outline-none placeholder-tg-hint/40"
        />
      </div>

      {/* Sort Options */}
      <div className="flex overflow-x-auto no-scrollbar gap-2 mb-4">
        {([
          { key: 'reputation' as SortOption, label: 'Top Rated' },
          { key: 'trades' as SortOption, label: 'Most Trades' },
          { key: 'volume' as SortOption, label: 'Top Volume' },
          { key: 'newest' as SortOption, label: 'Newest' },
        ]).map(opt => (
          <button
            key={opt.key}
            onClick={() => { setSort(opt.key); impact('light'); }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
              sort === opt.key
                ? 'bg-tg-button text-tg-button-text'
                : 'bg-tg-section-bg text-tg-hint'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Users List */}
      {loading ? (
        <div>
          {[1, 2, 3, 4, 5].map(i => <UserSkeleton key={i} />)}
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-tg-destructive mb-3">{error}</p>
          <button
            onClick={() => fetchUsers(1)}
            className="bg-tg-button text-tg-button-text px-6 py-2 rounded-xl text-sm"
          >
            Retry
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">&#x1F465;</p>
          <p className="text-tg-text font-semibold">No traders found</p>
          <p className="text-tg-hint text-sm mt-1">
            {search ? 'Try a different search' : 'Be the first to trade!'}
          </p>
        </div>
      ) : (
        <div>
          {users.map((user, index) => {
            const rank = getRankDisplay(index);
            return (
              <button
                key={user.id}
                onClick={() => { setSelectedUser(user); impact('light'); }}
                className="w-full bg-tg-section-bg rounded-2xl p-4 mb-3 text-left active:bg-tg-secondary-bg transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-tg-button/20 flex items-center justify-center">
                      <span className="text-tg-text text-sm font-bold">
                        {user.firstName[0].toUpperCase()}
                      </span>
                    </div>
                    <span className={`absolute -bottom-1 -right-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${rank.style}`}>
                      {rank.label}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-tg-text text-sm font-semibold truncate">
                        {user.username ? `@${user.username}` : user.firstName}
                      </p>
                      {user.kycStatus === 'VERIFIED' && (
                        <span className="text-xs flex-shrink-0">&#x2705;</span>
                      )}
                      {user.reputationTier?.badge && <span className="text-xs flex-shrink-0">{user.reputationTier.badge}</span>}
                    </div>
                    <p className="text-tg-hint text-xs">
                      {user.totalTrades} trades | ${user.totalVolume.toLocaleString()} vol
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-tg-text text-sm font-bold">{user.reputationScore.toFixed(1)}</p>
                    <p className="text-tg-hint text-[10px]">
                      <span className="text-[#22c55e]">+{user.totalUpvotes}</span>
                      {' / '}
                      <span className="text-tg-destructive">-{user.totalDownvotes}</span>
                    </p>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Load More */}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full text-center text-tg-link text-sm py-3"
            >
              {loadingMore ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin h-4 w-4 border-2 border-tg-button border-t-transparent rounded-full" />
                  Loading...
                </div>
              ) : (
                'Load More'
              )}
            </button>
          )}
        </div>
      )}

      {/* User Detail Modal */}
      {selectedUser && (
        <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}
