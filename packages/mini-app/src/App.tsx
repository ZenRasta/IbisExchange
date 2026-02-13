import { useEffect, useState, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { backButton } from '@telegram-apps/sdk-react';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';
import { apiCall } from './lib/api';

import Home from './pages/Home';
import OrderBook from './pages/OrderBook';
import CreateOrder from './pages/CreateOrder';
import Trade from './pages/Trade';
import MyTrades from './pages/MyTrades';
import Profile from './pages/Profile';
import KycVerification from './pages/KycVerification';
import Leaderboard from './pages/Leaderboard';
import Admin from './pages/Admin';

// Tab icons as SVG components for consistent rendering
function OrdersIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--tg-theme-button-color)' : 'var(--tg-theme-hint-color)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  );
}

function TradesIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--tg-theme-button-color)' : 'var(--tg-theme-hint-color)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23,6 13.5,15.5 8.5,10.5 1,18" />
      <polyline points="17,6 23,6 23,12" />
    </svg>
  );
}

function TradersIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--tg-theme-button-color)' : 'var(--tg-theme-hint-color)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function CreateIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--tg-theme-button-color)' : 'var(--tg-theme-hint-color)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--tg-theme-button-color)' : 'var(--tg-theme-hint-color)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { path: '/', label: 'Orders', icon: OrdersIcon },
    { path: '/my-trades', label: 'My Trades', icon: TradesIcon },
    { path: '/leaderboard', label: 'Traders', icon: TradersIcon },
    { path: '/create', label: 'Create', icon: CreateIcon },
    { path: '/profile', label: 'Profile', icon: ProfileIcon },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // Hide tabs on trade detail page, KYC page, and admin pages
  const hiddenPaths = ['/trade/', '/kyc', '/admin'];
  if (hiddenPaths.some(p => location.pathname.startsWith(p))) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-tg-bg border-t border-tg-secondary-bg z-50">
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        {tabs.map(tab => {
          const active = isActive(tab.path);
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="flex flex-col items-center justify-center flex-1 h-full"
            >
              <tab.icon active={active} />
              <span
                className="text-[10px] mt-0.5"
                style={{ color: active ? 'var(--tg-theme-button-color)' : 'var(--tg-theme-hint-color)' }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
      {/* Bottom safe area spacer */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}

function BackButtonHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const isRootPage = ['/', '/my-trades', '/create', '/profile', '/leaderboard'].includes(location.pathname);

    try {
      if (isRootPage) {
        if (backButton.isVisible()) backButton.hide();
      } else {
        backButton.show();
      }
    } catch {
      // backButton may not be available outside Telegram
    }

    const handleBack = () => {
      navigate(-1);
    };

    try {
      backButton.onClick(handleBack);
    } catch {
      // Ignore if not available
    }

    return () => {
      try {
        backButton.offClick(handleBack);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [location.pathname, navigate]);

  return null;
}

function Header() {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 border-b border-tg-secondary-bg"
      style={{ background: 'linear-gradient(135deg, var(--ibis-primary), var(--ibis-primary-light))' }}
    >
      <div className="flex items-center justify-between px-4 h-12">
        <span className="text-white font-semibold text-lg">Ibis Exchange</span>
        <TonConnectButton />
      </div>
    </div>
  );
}

function WalletSync() {
  const address = useTonAddress();
  const lastSynced = useRef<string>('');

  useEffect(() => {
    if (!address || address === lastSynced.current) return;
    lastSynced.current = address;
    apiCall('PUT', '/api/users/me', { tonAddress: address }).catch(() => {
      // Wallet sync failed silently - will retry on next connection
    });
  }, [address]);

  return null;
}

function AppContent() {
  return (
    <>
      <WalletSync />
      <BackButtonHandler />
      <Header />
      <main className="pt-12 pb-20 min-h-screen bg-tg-secondary-bg">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/orders" element={<OrderBook />} />
          <Route path="/create" element={<CreateOrder />} />
          <Route path="/trade/:id" element={<Trade />} />
          <Route path="/my-trades" element={<MyTrades />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/kyc" element={<KycVerification />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
      <TabBar />
    </>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Brief delay for TonConnect to restore session
    const t = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-tg-bg flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-tg-button border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
