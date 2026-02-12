import { useState } from 'react';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { beginCell, toNano, Address } from '@ton/core';
import { useHaptic } from '../hooks/useHaptic';
import { apiCall } from '../lib/api';

const ESCROW_CONTRACT = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS;
const USDT_MASTER = import.meta.env.VITE_USDT_MASTER;

// CRITICAL: USDT = 6 decimals. NEVER use toNano() for USDT amounts.
function usdtToUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

async function getUserUsdtWallet(userAddress: string): Promise<string> {
  const res = await fetch(
    `https://tonapi.io/v2/accounts/${encodeURIComponent(userAddress)}/jettons/${encodeURIComponent(USDT_MASTER)}`
  );
  if (!res.ok) throw new Error('Failed to get USDT wallet address');
  const data = await res.json();
  return data.wallet_address.address;
}

interface LockEscrowProps {
  tradeId: string;
  escrowId: number;
  amount: number;
  onSuccess: () => void;
  onError: (error: string) => void;
}

export default function LockEscrow({ tradeId, escrowId, amount, onSuccess, onError }: LockEscrowProps) {
  const [tonConnectUI] = useTonConnectUI();
  const address = useTonAddress();
  const { impact, notification } = useHaptic();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'fetching_wallet' | 'awaiting_approval' | 'confirming'>('idle');

  const handleLock = async () => {
    if (!address) {
      onError('Please connect your TON wallet first');
      return;
    }

    if (!ESCROW_CONTRACT) {
      onError('Escrow contract not configured');
      return;
    }

    impact('heavy');
    setLoading(true);
    setStep('fetching_wallet');

    try {
      // 1. Get user's USDT Jetton wallet address
      const jettonWalletAddr = await getUserUsdtWallet(address);

      // 2. Build Jetton transfer body
      const body = beginCell()
        .storeUint(0xf8a7ea5, 32)              // op: jetton transfer
        .storeUint(0, 64)                        // query_id
        .storeCoins(usdtToUnits(amount))         // USDT amount (6 decimals!)
        .storeAddress(Address.parse(ESCROW_CONTRACT)) // destination: escrow contract
        .storeAddress(Address.parse(address))    // response_destination: user
        .storeUint(0, 1)                         // no custom_payload
        .storeCoins(toNano('0.05'))              // forward_ton_amount (triggers notification)
        .storeBit(1)                             // forward_payload as ref
        .storeRef(
          beginCell()
            .storeUint(escrowId, 64)             // escrow ID
            .endCell()
        )
        .endCell();

      setStep('awaiting_approval');

      // 3. Send via TON Connect
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 360,
        messages: [
          {
            address: jettonWalletAddr,                 // User's Jetton wallet (NOT escrow!)
            amount: toNano('0.1').toString(),           // TON for gas
            payload: body.toBoc().toString('base64'),
          },
        ],
      });

      setStep('confirming');
      notification('success');

      // 4. Wait for on-chain confirmation (poll API)
      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const trade = await apiCall<{ status: string }>('GET', `/api/trades/${tradeId}`);
          if (trade.status !== 'AWAITING_ESCROW') {
            confirmed = true;
            break;
          }
        } catch {
          // Keep polling
        }
      }

      if (confirmed) {
        onSuccess();
      } else {
        onSuccess(); // Transaction sent, even if not confirmed yet
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      if (message.includes('Canceled') || message.includes('cancelled')) {
        // User rejected
        notification('warning');
      } else {
        notification('error');
      }
      onError(message);
    } finally {
      setLoading(false);
      setStep('idle');
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-tg-secondary-bg rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-tg-hint text-sm">Lock Amount</span>
          <span className="text-tg-text font-bold text-lg">{amount} USDT</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-tg-hint text-sm">Gas Fee</span>
          <span className="text-tg-text text-sm">~0.1 TON</span>
        </div>
      </div>

      {step === 'fetching_wallet' && (
        <div className="flex items-center gap-2 text-tg-hint text-sm animate-fade-in">
          <div className="animate-spin h-4 w-4 border-2 border-tg-button border-t-transparent rounded-full" />
          Preparing transaction...
        </div>
      )}
      {step === 'awaiting_approval' && (
        <div className="flex items-center gap-2 text-tg-accent text-sm animate-fade-in">
          <div className="animate-spin h-4 w-4 border-2 border-tg-accent border-t-transparent rounded-full" />
          Approve in your wallet...
        </div>
      )}
      {step === 'confirming' && (
        <div className="flex items-center gap-2 text-[#22c55e] text-sm animate-fade-in">
          <div className="animate-spin h-4 w-4 border-2 border-[#22c55e] border-t-transparent rounded-full" />
          Confirming on-chain...
        </div>
      )}

      <button
        onClick={handleLock}
        disabled={loading || !address}
        className="w-full bg-tg-button text-tg-button-text py-3.5 rounded-xl font-semibold active:scale-[0.98] transition-transform disabled:opacity-50"
      >
        {loading ? 'Processing...' : !address ? 'Connect Wallet First' : `Lock ${amount} USDT in Escrow`}
      </button>

      <p className="text-tg-hint text-xs text-center">
        USDT will be locked in the escrow smart contract until the trade completes.
      </p>
    </div>
  );
}
