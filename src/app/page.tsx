'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Show, SignInButton, SignUpButton } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clipboard,
  Layers3,
  Radar,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  Wallet,
  Zap,
} from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import AutoMintUserButton from '@/components/auth/automint-user-button';

const badges = ['Real-Time Analysis', 'Risk Detection', 'Demand Forecasting', 'Automation Ready'];

const stats = [
  { label: 'Collections Analyzed', value: '42.8K' },
  { label: 'Success Rate', value: '86%' },
  { label: 'Average ROI', value: '2.7x' },
  { label: 'Launchpads Monitored', value: '128' },
];

const features = [
  { title: 'Contract Detection', description: 'Identify verified mint contracts, function selectors, and launchpad mechanics.', icon: Radar },
  { title: 'Risk Scoring', description: 'Score contract, liquidity, holder, timing, and bot-pressure risk before committing capital.', icon: ShieldAlert },
  { title: 'Demand Forecasting', description: 'Model waitlists, social velocity, floor comps, and sell-through probability.', icon: BarChart3 },
  { title: 'Mint Strategy Engine', description: 'Generate wallet count, fee, timing, and fallback recommendations for each drop.', icon: Target },
  { title: 'Wallet Optimization', description: 'Track funding, chain readiness, exposure, and nonce health across execution wallets.', icon: Wallet },
  { title: 'Automation Preparation', description: 'Package requirements, calldata, guardrails, and readiness checks for execution.', icon: Zap },
];

const recent = [
  { name: 'Tensorian Seeds', chain: 'Solana', risk: 'Low', demand: 'High', score: 91 },
  { name: 'Eclipse Foundry', chain: 'Base', risk: 'Medium', demand: 'Very high', score: 84 },
  { name: 'Night Market Pass', chain: 'Ethereum', risk: 'Elevated', demand: 'Moderate', score: 69 },
];

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [isMinting, setIsMinting] = useState(false);
  const [mintSuccess, setMintSuccess] = useState(false);

  const analyzerHref = url.trim() ? `/analyzer?input=${encodeURIComponent(url.trim())}` : '/analyzer';

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      setInputError(null);
    } catch {
      setInputError('Clipboard access is unavailable in this browser.');
    }
  };

  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setInputError(null);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setInputError('Clipboard access is unavailable in this browser.');
    }
  };

  const submitAnalysis = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(analyzerHref);
  };

  const instantMint = async () => {
    if (!url.trim()) {
      setInputError('Please enter a mint URL');
      return;
    }

    setIsMinting(true);
    setInputError(null);
    setMintSuccess(false);

    try {
      const response = await fetch('/api/instant-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to execute instant mint');
      }

      setMintSuccess(true);
      setUrl('');
      // Redirect to mints page after successful mint
      setTimeout(() => router.push('/mints'), 1500);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : 'Failed to execute instant mint');
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <main className="automint-shell min-h-screen overflow-hidden">
      <section className="relative">
        <div className="surface-grid pointer-events-none absolute inset-0" />
        <header className="relative z-10 mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3" aria-label="AutoMint home">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/15">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-text">AutoMint</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex" aria-label="Public navigation">
            <Link href="/dashboard" className="hover:text-text">Dashboard</Link>
            <Link href="/analyzer" className="hover:text-text">Analyzer</Link>
            <Link href="/analytics" className="hover:text-text">Analytics</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Show when="signed-out">
              <SignInButton mode="redirect">
                <button type="button" className="hidden h-10 items-center px-3 text-sm text-muted hover:text-text sm:inline-flex">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="redirect">
                <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white shadow-lg shadow-primary/20 transition hover:bg-primary-hover">
                  Sign up
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white shadow-lg shadow-primary/20 transition hover:bg-primary-hover">
                Dashboard
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <div className="flex h-10 items-center rounded-lg border border-border bg-white/5 px-2">
                <AutoMintUserButton />
              </div>
            </Show>
          </div>
        </header>

        <div className="relative z-10 mx-auto grid min-h-[calc(100vh-64px)] max-w-[1280px] items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:py-14">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="mb-5 flex flex-wrap gap-2">
              {badges.map((badge) => (
                <Badge key={badge} variant="info">{badge}</Badge>
              ))}
            </div>
            <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[1.05] text-text sm:text-6xl lg:text-7xl">
              NFT Mint Intelligence
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              Analyze launchpads, detect risks, forecast demand, and execute winning mint strategies.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/analyzer"
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-lg bg-primary px-5 text-sm font-medium text-white shadow-lg shadow-primary/20 transition hover:bg-primary-hover"
              >
                Analyze Collection
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-lg border border-border bg-white/5 px-5 text-sm font-medium text-text transition hover:border-white/15 hover:bg-white/10"
              >
                View Dashboard
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12 }}
          >
            <Card tone="elevated" className="p-4 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-accent">Analysis Card</p>
                  <h2 className="mt-1 text-xl font-semibold text-text">Collection intake</h2>
                </div>
                <span className="rounded-lg border border-success/20 bg-success/10 px-3 py-1 text-xs text-success">Live</span>
              </div>

              <form onSubmit={submitAnalysis}>
                <label htmlFor="mint-url" className="mb-2 block text-sm font-medium text-muted">Launchpad or contract URL</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <input
                    id="mint-url"
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setInputError(null);
                    }}
                    placeholder="https://magiceden.io/launchpad/collection"
                    aria-invalid={Boolean(inputError)}
                    className="h-12 w-full rounded-lg border border-border bg-background/70 pl-10 pr-3 text-sm text-text outline-none transition placeholder:text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <Button type="button" variant="secondary" size="lg" onClick={pasteUrl}>
                  <Clipboard className="h-4 w-4" aria-hidden="true" />
                  Paste
                </Button>
                </div>
                {inputError ? <div className="mt-3 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">{inputError}</div> : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Button type="button" size="lg" onClick={copyUrl} disabled={!url}>
                  {copied ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Layers3 className="h-4 w-4" aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy URL'}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  onClick={instantMint}
                  disabled={!url || isMinting}
                  className="bg-success hover:bg-success/90"
                >
                  {isMinting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Minting...
                    </>
                  ) : mintSuccess ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Success!
                    </>
                  ) : (
                    <>
                      Mint
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
                </div>
              </form>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {/* Removed hardcoded Risk/Demand/Readiness mock data — analyzer page shows real metrics */}
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      <section className="border-y border-border bg-surface/35">
        <div className="mx-auto grid max-w-[1280px] grid-cols-2 gap-px px-4 py-6 sm:px-6 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="p-4">
              <p className="font-mono text-3xl font-semibold text-text">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-semibold uppercase text-accent">Platform</p>
          <h2 className="mt-2 text-3xl font-semibold text-text">Built for disciplined mint operations</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} tone="interactive" className="p-5">
              <feature.icon className="h-5 w-5 text-accent" aria-hidden="true" />
              <h3 className="mt-5 text-base font-semibold text-text">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{feature.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6">
        <Card className="overflow-hidden" tone="elevated">
          <div className="flex flex-col gap-2 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-accent">Recent Analyses</p>
              <h2 className="mt-1 text-xl font-semibold text-text">Latest mint intelligence</h2>
            </div>
            <Link href="/history" className="text-sm text-accent hover:text-text">View history</Link>
          </div>
          <div className="divide-y divide-border">
            {recent.map((item) => (
              <div key={item.name} className="grid gap-3 p-5 sm:grid-cols-[1fr_110px_110px_80px] sm:items-center">
                <div>
                  <p className="font-medium text-text">{item.name}</p>
                  <p className="text-sm text-muted">{item.chain}</p>
                </div>
                <Badge variant={item.risk === 'Low' ? 'success' : item.risk === 'Medium' ? 'warning' : 'danger'}>{item.risk} risk</Badge>
                <p className="text-sm text-muted">{item.demand}</p>
                <p className="font-mono text-lg text-text">{item.score}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <footer className="border-t border-border px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>AutoMint. Institutional-grade NFT mint intelligence.</p>
          <div className="flex gap-4">
            <Link href="/settings" className="hover:text-text">Security</Link>
            <Link href="/analytics" className="hover:text-text">Status</Link>
            <Link href="/dashboard" className="hover:text-text">Dashboard</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
