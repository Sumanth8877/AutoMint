import Link from 'next/link';
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
    glow: 'rgba(240,169,59,0.30)',
    accent: 'text-gold',
    border: 'border-gold/25',
    bg: 'bg-gold/8',
  },
  {
    icon: BarChart3,
    title: 'Mint Analyzer',
    description: 'AI-powered contract analysis with risk scoring, gas estimation, and market intelligence — before you pull the trigger.',
    href: '/analyzer',
    glow: 'rgba(0,255,136,0.25)',
    accent: 'text-neon',
    border: 'border-neon/25',
    bg: 'bg-neon/8',
  },
  {
    icon: Eye,
    title: 'Whale Tracker',
    description: 'Monitor elite wallets in real-time. Follow the smart money and mirror mint strategies of top collectors.',
    href: '/whale-tracker',
    glow: 'rgba(0,255,136,0.25)',
    accent: 'text-primary',
    border: 'border-primary/25',
    bg: 'bg-primary/8',
  },
  {
    icon: Shield,
    title: 'Risk Intelligence',
    description: 'Honeypot detection, rug-pull analysis, and contract security scoring powered by GoPlus and on-chain data.',
    href: '/analyzer',
    glow: 'rgba(0,255,136,0.25)',
    accent: 'text-success',
    border: 'border-success/25',
    bg: 'bg-success/8',
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
  { n: '01', title: 'Connect & Fund', description: 'Link your wallets and fund them in one screen. AutoMint never takes custody — keys stay encrypted, actions stay yours.' },
  { n: '02', title: 'Analyze the Mint', description: 'Paste a contract or URL. Get a risk score, gas estimate, and rug/honeypot check in seconds — before you commit.' },
  { n: '03', title: 'Queue the Strategy', description: 'Set whitelist, allowlist, or public-phase targeting with gas ceilings and retry logic tuned per wallet.' },
  { n: '04', title: 'Execute at Machine Speed', description: 'AutoMint fires the transaction the instant conditions are met — then tracks confirmation and outcome in your dashboard.' },
];

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-neon/25 bg-neon/10">
              <Zap className="h-4 w-4 text-neon" />
            </div>
            <span className="font-mono text-sm font-medium tracking-tight text-text">AutoMint</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-secondary md:flex">
            <a href="#features" className="transition-colors hover:text-text">Features</a>
            <a href="#how-it-works" className="transition-colors hover:text-text">How it works</a>
            <a href="#chains" className="transition-colors hover:text-text">Chains</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/sign-in" className="hidden text-sm font-medium text-secondary transition-colors hover:text-text sm:inline">
              Sign in
            </Link>
            <Magnetic strength={0.25}>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-background transition-transform"
                style={{ background: 'var(--color-primary)', boxShadow: '0 0 24px rgba(0,255,136,0.30)' }}
              >
                Launch Terminal
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
              backgroundImage: 'linear-gradient(rgba(0,255,136,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.035) 1px, transparent 1px)',
              backgroundSize: '64px 64px',
              maskImage: 'radial-gradient(ellipse 60% 50% at 50% 20%, black 0%, transparent 75%)',
            }}
          />
          <FloatingOrb className="left-[8%] top-[8%]" size={420} duration={16} />
          <FloatingOrb className="right-[6%] top-[28%]" size={360} duration={20} range={30} color="rgba(0,255,136,0.10)" />
        </div>
        <Spotlight className="-z-10" size={800} />

        <div className="w-full max-w-6xl space-y-10 text-center">
          <FadeIn className="space-y-8">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-neon/20 bg-neon/5 px-5 py-2 backdrop-blur-sm">
              <span className="live-dot" />
              <span className="text-xs font-semibold uppercase tracking-widest text-neon">Live NFT Minting Intelligence</span>
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
                  className="inline-flex items-center gap-3 rounded-xl px-8 py-4 text-sm font-semibold text-background transition-transform hover:brightness-110"
                  style={{ background: 'var(--color-primary)', boxShadow: '0 0 40px rgba(0,255,136,0.35), 0 0 12px rgba(0,255,136,0.40)' }}
                >
                  <Sparkles className="h-4 w-4" />
                  Launch Terminal
                </Link>
              </Magnetic>
              <Magnetic strength={0.3}>
                <Link
                  href="/analyzer"
                  className="inline-flex items-center gap-3 rounded-xl border border-border-strong px-8 py-4 text-sm font-semibold text-text transition-colors hover:border-neon/40 hover:bg-neon/5"
                >
                  <BarChart3 className="h-4 w-4 text-neon" />
                  Analyze a Mint
                </Link>
              </Magnetic>
            </div>
          </FadeIn>

          {/* Hero visual — 3D-tilt terminal mockup */}
          <Reveal amount={0.1} className="mx-auto w-full max-w-4xl pt-6">
            <TiltCard max={6} className="w-full">
              <div
                className="relative overflow-hidden rounded-2xl border border-border-strong bg-surface/90 text-left shadow-2xl backdrop-blur-sm"
                style={{ boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,255,136,0.06)' }}
              >
                <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-gold/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
                  <span className="ml-3 font-mono text-[11px] text-muted">automint — mission-control</span>
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-neon">
                    <Radio className="h-3 w-3" /> Live
                  </span>
                </div>
                <div className="grid gap-px bg-border sm:grid-cols-3">
                  {[
                    { label: 'Active Mints', value: '7', icon: Zap, tone: 'text-neon' },
                    { label: 'Risk Score', value: '12/100', icon: Shield, tone: 'text-success' },
                    { label: 'Gas', value: '0.4 gwei', icon: TrendingUp, tone: 'text-gold' },
                  ].map((s) => (
                    <div key={s.label} className="bg-surface p-5">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                        <s.icon className={`h-3 w-3 ${s.tone}`} />
                        {s.label}
                      </div>
                      <p className="stat-value text-2xl font-medium text-text">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 p-5 font-mono text-[12px] leading-relaxed text-secondary">
                  <p><span className="text-muted">$</span> analyze --contract 0x71C7...976F</p>
                  <p className="text-success">✓ Honeypot check passed · 0 red flags</p>
                  <p className="text-neon">→ Queued mint · whitelist phase · gas ceiling 0.6 gwei</p>
                  <p><span className="text-muted">$</span> <span className="animate-pulse">▍</span></p>
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
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{s.label}</p>
                </div>
              </TiltCard>
            </StaggerItem>
          ))}
        </Stagger>

        {/* ── Feature grid ── */}
        <div id="features" className="space-y-10">
          <Reveal className="mx-auto max-w-2xl space-y-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon">Capabilities</p>
            <h2 className="text-3xl font-medium tracking-tight text-text sm:text-4xl">Everything you need to mint, minus the guesswork.</h2>
          </Reveal>

          <Stagger className="grid gap-5 md:grid-cols-2" inView>
            {features.map((f) => (
              <StaggerItem key={f.title} className="h-full">
                <TiltCard max={4} className="h-full">
                  <Link
                    href={f.href}
                    className="group relative block h-full overflow-hidden rounded-2xl border p-7 transition-colors"
                    style={{
                      background: `radial-gradient(ellipse at 20% 20%, ${f.glow.replace('0.', '0.08')} 0%, transparent 60%), rgba(17,17,17,0.85)`,
                      borderColor: f.border.replace('border-', ''),
                    }}
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-px"
                      style={{ background: `linear-gradient(90deg, transparent, ${f.glow}, transparent)` }}
                    />
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex h-12 w-12 items-center justify-center rounded-xl border ${f.border} ${f.bg} transition-transform duration-300 group-hover:scale-110`}
                          style={{ boxShadow: f.glow }}
                        >
                          <f.icon className={`h-6 w-6 ${f.accent}`} />
                        </div>
                        <h3 className="text-xl font-medium tracking-tight text-text">{f.title}</h3>
                      </div>
                      <p className="text-sm leading-relaxed text-secondary">{f.description}</p>
                      <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-widest ${f.accent}`}>
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
        <div id="how-it-works" className="space-y-10">
          <Reveal className="mx-auto max-w-2xl space-y-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon">Workflow</p>
            <h2 className="text-3xl font-medium tracking-tight text-text sm:text-4xl">From wallet to confirmed mint in four steps.</h2>
          </Reveal>

          <Stagger className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4" inView stagger={0.1}>
            <div className="absolute left-0 right-0 top-6 hidden h-px bg-border lg:block" aria-hidden="true" />
            {steps.map((s) => (
              <StaggerItem key={s.n}>
                <div className="relative space-y-3 rounded-2xl border border-border bg-surface/50 p-6">
                  <span className="stat-value text-xs font-semibold text-neon">{s.n}</span>
                  <h3 className="text-base font-medium text-text">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-secondary">{s.description}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>

        {/* ── Final CTA ── */}
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border-strong p-10 text-center sm:p-16">
            <div className="absolute inset-0 -z-10 bg-surface/60" />
            <FloatingOrb className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" size={520} color="rgba(0,255,136,0.14)" />
            <div className="relative space-y-6">
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-neon/20 bg-neon/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-neon">
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
                    className="inline-flex items-center gap-3 rounded-xl px-8 py-4 text-sm font-semibold text-background transition-transform hover:brightness-110"
                    style={{ background: 'var(--color-primary)', boxShadow: '0 0 40px rgba(0,255,136,0.35)' }}
                  >
                    Get Started <ChevronRight className="h-4 w-4" />
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
            <div className="flex h-6 w-6 items-center justify-center rounded-md border border-neon/25 bg-neon/10">
              <Zap className="h-3 w-3 text-neon" />
            </div>
            <span className="font-mono text-xs text-muted">AutoMint · NFT Mint Intelligence</span>
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
