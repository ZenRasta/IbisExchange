import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import { VeriffKyc } from '../components/VeriffKyc';
import type { KycStatus } from '../lib/types';

export default function KycVerification() {
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVeriff, setShowVeriff] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    setLoading(true);
    try {
      const data = await apiCall<KycStatus>('GET', '/api/kyc/status');
      setKycStatus(data);
    } catch {
      // Status check failed, allow starting verification
    } finally {
      setLoading(false);
    }
  }

  const handleComplete = () => {
    setShowVeriff(false);
    checkStatus();
  };

  if (loading) {
    return (
      <div className="px-4 py-8">
        <div className="bg-tg-section-bg rounded-2xl p-6">
          <div className="skeleton h-6 w-48 rounded mb-4 mx-auto" />
          <div className="skeleton h-4 w-64 rounded mb-6 mx-auto" />
          <div className="skeleton h-40 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // Already verified
  if (kycStatus?.status === 'VERIFIED') {
    return (
      <div className="px-4 py-8 animate-fade-in">
        <div className="bg-tg-section-bg rounded-2xl p-6 text-center">
          <p className="text-5xl mb-4">&#x2705;</p>
          <h2 className="text-tg-text text-xl font-bold mb-2">Identity Verified</h2>
          <p className="text-tg-hint text-sm mb-4">
            Your identity has been verified. You have access to full trading limits.
          </p>
          {kycStatus.verifiedAt && (
            <p className="text-tg-hint text-xs">
              Verified on {new Date(kycStatus.verifiedAt).toLocaleDateString()}
            </p>
          )}
          <div className="bg-[#22c55e]/10 rounded-xl p-4 mt-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-tg-hint">Max per trade</span>
              <span className="text-[#22c55e] font-semibold">5,000 USDT</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-tg-hint">Daily limit</span>
              <span className="text-[#22c55e] font-semibold">10,000 USDT</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Pending review
  if (kycStatus?.status === 'PENDING') {
    return (
      <div className="px-4 py-8 animate-fade-in">
        <div className="bg-tg-section-bg rounded-2xl p-6 text-center">
          <p className="text-5xl mb-4">&#x23F3;</p>
          <h2 className="text-tg-text text-xl font-bold mb-2">Under Review</h2>
          <p className="text-tg-hint text-sm">
            Your documents are being reviewed. This usually takes a few minutes.
            We'll notify you via the bot when verification is complete.
          </p>
          <button
            onClick={checkStatus}
            className="mt-4 text-tg-link text-sm"
          >
            Check Status
          </button>
        </div>
      </div>
    );
  }

  // Action required - resubmission requested
  if (kycStatus?.status === 'ACTION_REQUIRED') {
    return (
      <div className="px-4 py-8 animate-fade-in">
        <div className="bg-tg-section-bg rounded-2xl p-6 text-center">
          <p className="text-5xl mb-4">&#x26A0;&#xFE0F;</p>
          <h2 className="text-tg-text text-xl font-bold mb-2">Action Required</h2>
          <p className="text-tg-hint text-sm mb-4">
            Your verification needs additional information. Please resubmit your documents.
          </p>
          <button
            onClick={() => setShowVeriff(true)}
            className="bg-tg-button text-tg-button-text px-6 py-3 rounded-xl font-semibold"
          >
            Resubmit Documents
          </button>
        </div>

        {showVeriff && (
          <div className="mt-4">
            <VeriffKyc onComplete={handleComplete} />
          </div>
        )}
      </div>
    );
  }

  // Rejected
  if (kycStatus?.status === 'REJECTED') {
    return (
      <div className="px-4 py-8 animate-fade-in">
        <div className="bg-tg-section-bg rounded-2xl p-6 text-center">
          <p className="text-5xl mb-4">&#x274C;</p>
          <h2 className="text-tg-text text-xl font-bold mb-2">Verification Declined</h2>
          <p className="text-tg-hint text-sm mb-4">
            Unfortunately, your verification was not successful.
            You can try again with valid documents.
          </p>
          <button
            onClick={() => setShowVeriff(true)}
            className="bg-tg-button text-tg-button-text px-6 py-3 rounded-xl font-semibold"
          >
            Try Again
          </button>
        </div>

        {showVeriff && (
          <div className="mt-4">
            <VeriffKyc onComplete={handleComplete} />
          </div>
        )}
      </div>
    );
  }

  // Unverified - Show info + start verification
  return (
    <div className="px-4 py-4 animate-fade-in">
      <div className="bg-tg-section-bg rounded-2xl p-5 mb-4">
        <h2 className="text-tg-text text-xl font-bold mb-2 text-center">
          Identity Verification
        </h2>
        <p className="text-tg-hint text-sm text-center mb-6">
          Complete KYC verification to unlock higher trade limits and build trust.
        </p>

        {/* Steps Preview */}
        <div className="space-y-3 mb-6">
          {[
            { icon: '\uD83C\uDD94', title: 'ID Document', desc: 'Upload a valid government-issued ID' },
            { icon: '\uD83E\uDD33', title: 'Face Verification', desc: 'Take a quick selfie for face matching' },
            { icon: '\uD83C\uDFE6', title: 'Bank Statement', desc: 'Upload a recent bank statement for address proof' },
            { icon: '\u2705', title: 'Review', desc: 'Automated review, usually takes minutes' },
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-tg-secondary-bg flex items-center justify-center text-lg shrink-0">
                {step.icon}
              </div>
              <div>
                <p className="text-tg-text text-sm font-semibold">{step.title}</p>
                <p className="text-tg-hint text-xs">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Limits comparison */}
        <div className="bg-tg-secondary-bg rounded-xl p-4 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-tg-hint text-xs mb-2 font-semibold">Without KYC</p>
              <p className="text-tg-text text-sm">500 USDT/trade</p>
              <p className="text-tg-text text-sm">1,000 USDT/day</p>
            </div>
            <div>
              <p className="text-[#22c55e] text-xs mb-2 font-semibold">With KYC</p>
              <p className="text-tg-text text-sm font-semibold">5,000 USDT/trade</p>
              <p className="text-tg-text text-sm font-semibold">10,000 USDT/day</p>
            </div>
          </div>
        </div>

        {!showVeriff ? (
          <button
            onClick={() => setShowVeriff(true)}
            className="w-full bg-tg-button text-tg-button-text py-3.5 rounded-xl font-semibold active:scale-[0.98] transition-transform"
          >
            Start Verification
          </button>
        ) : (
          <div className="animate-slide-up">
            <VeriffKyc onComplete={handleComplete} />
          </div>
        )}
      </div>

      <p className="text-tg-hint text-xs text-center px-4">
        Your data is securely processed by Veriff, a certified identity verification provider.
        We never store your raw documents.
      </p>
    </div>
  );
}
