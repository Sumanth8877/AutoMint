'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Rocket, Wallet, Gauge, Zap, Timer } from 'lucide-react';
import Button from '@/components/ui/Button';
import { apiRequest } from '@/lib/api/client';

const STEPS = [
  {
    title: 'Import Your Wallet',
    description:
      'Import your wallet to get started. AutoMint supports EVM wallets across Ethereum, Base, Polygon, and Arbitrum.',
    image: '/illustrations/workflow-01-import-wallet.jpeg',
    imageAlt: 'A small character opening a large vault door to reveal crypto wallets inside.',
    icon: Wallet,
    cta: { label: 'Go to Wallets', href: '/wallets' },
  },
  {
    title: 'Analyze a Mint',
    description:
      'Paste any mint URL or contract address. AutoMint runs AI-powered risk analysis, gas estimation, and market intelligence before you commit.',
    image: '/illustrations/workflow-02-analyze-mint.jpeg',
    imageAlt: 'A small character studying a magnifying glass over a glowing contract document.',
    icon: Gauge,
  },
  {
    title: 'Queue Your Strategy',
    description:
      'Set your minting strategy: quantity, gas mode, phase targeting. AutoMint auto-detects timing and fires at the optimal moment.',
    image: '/illustrations/workflow-03-queue-strategy.jpeg',
    imageAlt: 'A small character arranging glowing mint cards on a strategy board.',
    icon: Timer,
  },
  {
    title: 'Execute at Speed',
    description:
      'AutoMint executes with sub-50ms latency, optimised gas, and automatic receipt confirmation. Sit back and watch.',
    image: '/illustrations/workflow-04-execute-speed.jpeg',
    imageAlt: 'A small character riding a rocket through a tunnel of blockchain blocks.',
    icon: Zap,
  },
];

interface OnboardingWizardProps {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [completing, setCompleting] = useState(false);
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  async function handleComplete() {
    setCompleting(true);
    try {
      await apiRequest('/api/onboarding/complete', { method: 'POST' });
    } catch {
      // Best-effort — don't block the user from entering the app
    }
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Progress bar */}
        <div className="flex gap-1.5 px-6 pt-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 pt-5">
          {/* Illustration */}
          <div className="relative mx-auto mb-5 aspect-[16/9] w-full overflow-hidden rounded-xl border border-border bg-white">
            <Image
              src={current.image}
              alt={current.imageAlt}
              fill
              sizes="(min-width: 640px) 28rem, 90vw"
              className="object-contain p-3"
              priority
            />
          </div>

          {/* Step indicator */}
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/20 bg-indigo-50">
              <Icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Step {step + 1} of {STEPS.length}
            </span>
          </div>

          <h2 className="text-lg font-bold text-text">{current.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {current.description}
          </p>

          {/* Optional CTA link */}
          {current.cta && (
            <Link
              href={current.cta.href}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              {current.cta.label}
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="secondary"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
              className={step === 0 ? 'invisible' : ''}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>

            {isLast ? (
              <Button variant="neon" onClick={handleComplete} loading={completing} glow>
                <Rocket className="h-3.5 w-3.5" />
                {completing ? 'Starting...' : 'Get Started'}
              </Button>
            ) : (
              <Button onClick={() => setStep((s) => s + 1)}>
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Skip button */}
        <button
          type="button"
          onClick={handleComplete}
          className="absolute right-4 top-4 text-xs text-muted hover:text-text transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
