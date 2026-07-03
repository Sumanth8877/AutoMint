import Image from 'next/image';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import {
  Activity, ArrowRight, BarChart3, ChevronRight, Eye, Shield,
  Sparkles, TrendingUp, Wallet, Zap, Radio, CheckCircle2, FileCode2,
} from 'lucide-react';
import {
  FadeIn, Stagger, StaggerItem, Reveal, TiltCard, Magnetic,
  Spotlight, FloatingOrb, Marquee, AnimatedNumber,
} from '@/components/motion';

const features = [
  {
    icon: Zap,
    title: 'Auto-Mint Engine',
    description: 'Fire mints in milliseconds with gas-optimised transactions across all major chains. Whitelist, allowlist, and public phase targeting.',
    href: '/mints',
    glow: 'rgba(245,158,11,0.15)',
    accent: 'text-gold',
    border: 'border-gold/15',
    bg: 'bg-amber-50',
  },
  {
    icon: BarChart3,
    title: 'Mint Analyzer',
    description: 'AI-powered contract analysis with risk scoring, gas estimation, and market intelligence — before you pull the trigger.',
    href: '/analyzer',
    glow: 'rgba(79,70,229,0.12)',
    accent: 'text-primary',
    border: 'border-primary/15',
    bg: 'bg-indigo-50',
  },
  {
    icon: Eye,
    title: 'Whale Tracker',
    description: 'Monitor elite wallets in real-time. Follow the smart money and mirror mint strategies of top collectors.',
    href: '/whale-tracker',
    glow: 'rgba(79,70,229,0.12)',
    accent: 'text-primary',
    border: 'border-primary/15',
    bg: 'bg-indigo-50',
  },
  {
    icon: Shield,
    title: 'Risk Intelligence',
    description: 'Honeypot detection, rug-pull analysis, and contract security scoring powered by GoPlus and on-chain data.',
    href: '/analyzer',
    glow: 'rgba(79,70,229,0.12)',
    accent: 'text-success',
    border: 'border-success/20',
    bg: 'bg-emerald-50',
  },
];

const stats = [
  { value: 50, prefix: '<', suffix: 'ms', label: 'Mint Latency' },
  { value: 99.9, decimals: 1, suffix: '%', label: 'Uptime' },
  { value: 15, suffix: '+', label: 'Chains' },
  { value: 24, suffix: '/7', label: 'Monitoring' },
];

const chains = ['Ethereum', 'Base', 'Arbitrum', 'Polygon', 'Optimism', 'Blast', 'Zora', 'Avalanche', 'BNB Chain', 'Linea'];

const steps = [
  {
    n: '01',
    title: 'Import Your Signing Wallets',
    description: 'Add wallets by importing private keys — AutoMint encrypts them in a vault on our side. Keys never leave, no custody, works across every supported chain.',
    image: '/illustrations/workflow-01-import-wallet.jpeg',
    alt: 'A small character inserting a private key into an encrypted vault holding multi-chain wallets.',
  },
  {
    n: '02',
    title: 'Paste. Analyze. Decide.',
    description: 'Drop in a launchpad URL, explorer link, or 0x contract. Get a risk score, gas estimate, and rug/honeypot verdict in seconds — before you commit a single wei.',
    image: '/illustrations/workflow-02-analyze-mint.jpeg',
    alt: 'A small character analyzing a pasted URL and outputting risk score, gas estimate, and rug check tags marked SAFE.',
  },
  {
    n: '03',
    title: 'Queue With Your Strategy',
    description: 'Create a mint task with whitelist mode, scheduled time, gas ceiling, and auto-retry. Every wallet runs its own tuned playbook — you set the rules once, we execute them.',
    image: '/illustrations/workflow-03-queue-strategy.jpeg',
    alt: 'A mint task ticket showing whitelist toggle, scheduled time, and gas ceiling with auto-retry annotation.',
  },
  {
    n: '04',
    title: 'AutoMint Fires at T=0',
    description: 'The moment mint conditions hit, AutoMint fires the transaction — monitoring → ready → confirmed in under 50 ms. Watch every outcome land in your dashboard.',
    image: '/illustrations/workflow-04-execute-speed.jpeg',
    alt: 'A small character auto-firing a MINT button at a scheduled time, with statuses monitoring, ready, confirmed in under 50 ms.',
  },
];

export default async function Home() {
  const { userId } = await auth();
  const isSignedIn = Boolean(userId);

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-surface/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/15 bg-indigo-50">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <span className="font-mono text-sm font-medium tracking-tight text-text">AutoMint</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-secondary md:flex">
            <a href="#features" className="transition-colors hover:text-text">Features</a>
            <a href="#how-it-works" className="transition-colors hover:text-text">How it works</a>
            <a href="#chains" className="transition-colors hover:text-text">Chains</a>
          </nav>
          <div className="flex items-center gap-3">
            {!isSignedIn && (
              <Link href="/sign-in" className="hidden text-sm font-medium text-secondary transition-colors hover:text-text sm:inline">
                Sign in
              </Link>
            )}
            <Magnetic strength={0.25}>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-background transition-transform"
                style={{ background: 'var(--color-primary)', boxShadow: '0 0 24px rgba(79,70,229,0.15)' }}
              >
                {isSignedIn ? 'Go to Dashboard' : 'Launch Terminal'}
              </Link>
            </Magnetic>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center justify-center overflow-hidden px-4 pt-20 pb-24 sm:px-8 sm:pt-28">
        <div className="absolute inset-0 -z-10">
          <div className="automint-shell absolute inset-0" />
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage: 'linear-gradient(rgba(79,70,229,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(79,70,229,0.02) 1px, transparent 1px)',
              backgroundSize: '64px 64px',
              maskImage: 'radial-gradient(ellipse 60% 50% at 50% 20%, black 0%, transparent 75%)',
            }}
          />
          <FloatingOrb className="left-[8%] top-[8%]" size={420} duration={16} />
          <FloatingOrb className="right-[6%] top-[28%]" size={360} duration={20} range={30} color="rgba(79,70,229,0.05)" />
        </div>
        <Spotlight className="-z-10" size={800} />

        <div className="w-full max-w-6xl space-y-10 text-center">
          <FadeIn className="space-y-8">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-primary/20 bg-indigo-50 px-5 py-2 backdrop-blur-sm">
              <span className="live-dot" />
              <span className="text-xs font-semibold uppercase tracking-widest text-primary">Live NFT Minting Intelligence</span>
            </div>

            <div>
              <h1 className="text-5xl font-medium leading-[0.95] tracking-tight text-text sm:text-7xl lg:text-8xl">
                Mint faster than
                <br />
                <span style={{ color: 'var(--color-primary)' }}>everyone else.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
                Analyze contracts, execute mints at machine speed, and track alpha from elite wallets —
                all in one intelligence terminal built for serious collectors.
              </p>
            </div>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Magnetic strength={0.3}>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-3 rounded-xl px-8 py-4 text-sm font-semibold text-background transition-transform hover:brightness-105"
                  style={{ background: 'var(--color-primary)', boxShadow: '0 0 40px rgba(79,70,229,0.20), 0 0 12px rgba(79,70,229,0.25)' }}
                >
                  <Sparkles className="h-4 w-4" />
                  {isSignedIn ? 'Go to Dashboard' : 'Launch Terminal'}
                </Link>
              </Magnetic>
              <Magnetic strength={0.3}>
                <Link
                  href="/analyzer"
                  className="inline-flex items-center gap-3 rounded-xl border border-border-strong px-8 py-4 text-sm font-semibold text-text transition-colors hover:border-primary/30 hover:bg-indigo-50"
                >
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Analyze a Mint
                </Link>
              </Magnetic>
            </div>
          </FadeIn>

          {/* Hero visual — Xiaohei mint machine illustration */}
          <Reveal amount={0.1} className="mx-auto w-full max-w-4xl pt-6">
            <TiltCard max={6} className="w-full">
              <div
                className="relative overflow-hidden rounded-2xl border border-border-strong bg-white text-left shadow-lg backdrop-blur-sm"
                style={{ boxShadow: '0 30px 80px rgba(0,0,0,0.08), 0 0 0 1px rgba(79,70,229,0.03)' }}
              >
                <div className="flex items-center gap-2 border-b border-border bg-surface/90 px-5 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-gold/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
                  <span className="ml-3 font-mono text-[11px] text-muted">automint — mission-control</span>
                  <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                    How it works
                  </span>
                </div>
                <div className="relative aspect-[16/9] w-full">
                  <Image
                    src="/illustrations/hero-mint-machine.jpeg"
                    alt="A small character energetically cranking a hand-drawn mint machine while a stream of minted NFTs flies out the chute."
                    fill
                    sizes="(min-width: 1024px) 56rem, 90vw"
                    priority
                    className="object-contain p-4"
                  />
                </div>
                <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
                  {[
                    { label: 'Latency', value: '< 50 ms', icon: Zap, tone: 'text-primary' },
                    { label: 'Custody', value: 'Non-custodial', icon: Shield, tone: 'text-success' },
                    { label: 'Chains', value: '15+ EVM', icon: TrendingUp, tone: 'text-gold' },
                  ].map((s) => (
                    <div key={s.label} className="bg-surface p-5">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                        <s.icon className={`h-3 w-3 ${s.tone}`} />
                        {s.label}
                      </div>
                      <p className="stat-value text-lg font-medium text-text">{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </TiltCard>
          </Reveal>
        </div>
      </section>

      {/* ── Trusted chains marquee ── */}
      <section id="chains" className="border-y border-border/60 bg-surface/40 py-6">
        <Marquee duration={26}>
          {chains.map((c) => (
            <span key={c} className="flex items-center gap-3 text-sm font-medium uppercase tracking-widest text-muted">
              {c}
              <span className="h-1 w-1 rounded-full bg-muted/40" />
            </span>
          ))}
        </Marquee>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-28 px-4 py-24 sm:px-8">
        {/* ── Stats ── */}
        <Stagger className="grid grid-cols-2 gap-4 sm:grid-cols-4" inView>
          {stats.map((s) => (
            <StaggerItem key={s.label}>
              <TiltCard max={5} className="h-full">
                <div className="flex h-full flex-col items-center gap-2 rounded-2xl border border-border bg-surface/60 p-6 text-center backdrop-blur-sm">
                  <AnimatedNumber
                    value={s.value}
                    prefix={s.prefix}
                    suffix={s.suffix}
                    decimals={s.decimals}
                    className="stat-value text-3xl font-medium tracking-tight text-text"
                  />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted">{s.label}</p>
                </div>
              </TiltCard>
            </StaggerItem>
          ))}
        </Stagger>

        {/* ── Feature grid ── */}
        <div id="features" className="space-y-10">
          <Reveal className="mx-auto max-w-2xl space-y-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Capabilities</p>
            <h2 className="text-3xl font-medium tracking-tight text-text sm:text-4xl">Everything you need to mint, minus the guesswork.</h2>
          </Reveal>

          <Stagger className="grid gap-5 md:grid-cols-2" inView>
            {features.map((f) => (
              <StaggerItem key={f.title} className="h-full">
                <TiltCard max={4} className="h-full">
                  <Link
                    href={f.href}
                    className="group relative block h-full overflow-hidden rounded-2xl border border-border bg-surface p-7 shadow-sm transition-all duration-200 hover:border-border-strong hover:shadow-md"
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-[2px]"
                      style={{ background: `linear-gradient(90deg, transparent, ${f.glow}, transparent)` }}
                    />
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex h-12 w-12 items-center justify-center rounded-xl border ${f.border} ${f.bg} transition-transform duration-300 group-hover:scale-105`}
                          style={{ boxShadow: f.glow }}
                        >
                          <f.icon className={`h-6 w-6 ${f.accent}`} />
                        </div>
                        <h3 className="text-xl font-medium tracking-tight text-text">{f.title}</h3>
                      </div>
                      <p className="text-sm leading-relaxed text-secondary">{f.description}</p>
                      <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${f.accent}`}>
                        <span>Enter Module</span>
                        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                      </div>
                    </div>
                  </Link>
                </TiltCard>
              </StaggerItem>
            ))}
          </Stagger>
        </div>

        {/* ── How it works ── */}
        <div id="how-it-works" className="space-y-16">
          <Reveal className="mx-auto max-w-2xl space-y-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Workflow</p>
            <h2 className="text-3xl font-medium tracking-tight text-text sm:text-4xl">From wallet to confirmed mint in four steps.</h2>
            <p className="text-sm leading-relaxed text-secondary sm:text-base">
              Import once. Analyze anything. Queue your strategy. Let AutoMint fire the transaction the instant the mint opens.
            </p>
          </Reveal>

          <Stagger className="space-y-14 sm:space-y-20" inView stagger={0.12}>
            {steps.map((s, i) => {
              const imageFirst = i % 2 === 0;
              return (
                <StaggerItem key={s.n}>
                  <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
                    <div className={`relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border bg-white ${imageFirst ? 'md:order-1' : 'md:order-2'}`}>
                      <Image
                        src={s.image}
                        alt={s.alt}
                        fill
                        sizes="(min-width: 768px) 45vw, 90vw"
                        className="object-contain p-3 sm:p-5"
                      />
                    </div>
                    <div className={`space-y-4 ${imageFirst ? 'md:order-2' : 'md:order-1'}`}>
                      <span className="stat-value inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                        <span className="inline-block h-px w-6 bg-primary/50" aria-hidden="true" />
                        Step {s.n}
                      </span>
                      <h3 className="text-2xl font-medium tracking-tight text-text sm:text-3xl">{s.title}</h3>
                      <p className="text-base leading-relaxed text-secondary">{s.description}</p>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        </div>

        {/* ── Final CTA ── */}
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border-strong p-10 text-center sm:p-16">
            <div className="absolute inset-0 -z-10 bg-surface/60" />
            <FloatingOrb className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" size={520} color="rgba(79,70,229,0.06)" />
            <div className="relative space-y-6">
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-indigo-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" /> No custody, no black box
              </div>
              <h2 className="text-3xl font-medium tracking-tight text-text sm:text-5xl">Ready to mint smarter?</h2>
              <p className="mx-auto max-w-xl text-secondary">
                Set up your wallets and run your first risk analysis in under two minutes.
              </p>
              <div className="flex justify-center pt-2">
                <Magnetic strength={0.3}>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-3 rounded-xl px-8 py-4 text-sm font-semibold text-background transition-transform hover:brightness-105"
                    style={{ background: 'var(--color-primary)', boxShadow: '0 0 40px rgba(79,70,229,0.20)' }}
                  >
                    {isSignedIn ? 'Go to Dashboard' : 'Get Started'} <ChevronRight className="h-4 w-4" />
                  </Link>
                </Magnetic>
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-border/60 px-4 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md border border-primary/15 bg-indigo-50">
              <Zap className="h-3 w-3 text-primary" />
            </div>
            <span className="text-xs text-muted">AutoMint · NFT Mint Intelligence</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted">
            <span className="flex items-center gap-1.5"><Activity className="h-3 w-3 text-success" /> Systems operational</span>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-text">
              <FileCode2 className="h-3 w-3" /> GitHub
            </a>
            <span className="flex items-center gap-1.5"><Wallet className="h-3 w-3" /> Non-custodial</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
