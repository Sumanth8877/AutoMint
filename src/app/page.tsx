import Link from 'next/link';
import { Activity, BarChart3, Shield, Sparkles, TrendingUp, Wallet, Zap, Eye } from 'lucide-react';

const features = [
  {
    icon: Zap,
    title: 'Auto-Mint Engine',
    description: 'Fire mints in milliseconds with gas-optimised transactions across all major chains. Whitelist, allowlist, and public phase targeting.',
    href: '/mints',
    glow: 'rgba(245,158,11,0.30)',
    accent: 'text-gold',
    border: 'border-gold/25',
    bg: 'bg-gold/8',
  },
  {
    icon: BarChart3,
    title: 'Mint Analyzer',
    description: 'AI-powered contract analysis with risk scoring, gas estimation, and market intelligence — before you pull the trigger.',
    href: '/analyzer',
    glow: 'rgba(0,245,255,0.25)',
    accent: 'text-neon',
    border: 'border-neon/25',
    bg: 'bg-neon/8',
  },
  {
    icon: Eye,
    title: 'Whale Tracker',
    description: 'Monitor elite wallets in real-time. Follow the smart money and mirror mint strategies of top collectors.',
    href: '/whale-tracker',
    glow: 'rgba(124,58,237,0.25)',
    accent: 'text-primary',
    border: 'border-primary/25',
    bg: 'bg-primary/8',
  },
  {
    icon: Shield,
    title: 'Risk Intelligence',
    description: 'Honeypot detection, rug-pull analysis, and contract security scoring powered by GoPlus and on-chain data.',
    href: '/analyzer',
    glow: 'rgba(16,185,129,0.25)',
    accent: 'text-success',
    border: 'border-success/25',
    bg: 'bg-success/8',
  },
];

const stats = [
  { value: '< 50ms', label: 'Mint Latency', icon: Zap },
  { value: '99.9%', label: 'Uptime', icon: Activity },
  { value: '15+', label: 'Chains', icon: TrendingUp },
  { value: '∞', label: 'Wallets', icon: Wallet },
];

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4 sm:p-8">
      {/* Atmospheric background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(124,58,237,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(0,245,255,0.08),transparent_55%)]" />
        {/* Grid */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,245,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,245,255,0.04) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      <div className="w-full max-w-6xl space-y-20">
        {/* Hero */}
        <div className="text-center space-y-8">
          {/* Status pill */}
          <div className="inline-flex items-center gap-2.5 rounded-full border border-neon/20 bg-neon/5 px-5 py-2 backdrop-blur-sm">
            <span className="live-dot" />
            <span className="text-xs font-bold uppercase tracking-widest text-neon">Live NFT Minting Intelligence</span>
          </div>

          {/* Heading */}
          <div>
            <h1 className="text-6xl font-black tracking-tight sm:text-8xl lg:text-9xl leading-none">
              <span className="gradient-text-neon">Auto</span>
              <span className="text-text">Mint</span>
            </h1>
            <p className="mt-3 text-sm font-bold uppercase tracking-[0.25em] text-muted">
              Production NFT Minter · On-Chain · Automated
            </p>
          </div>

          <p className="text-lg text-secondary max-w-2xl mx-auto leading-relaxed">
            The most advanced automated NFT minting platform. Analyze contracts, execute mints at machine speed,
            and track alpha from elite wallets — all in one intelligence terminal.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-3 rounded-xl px-8 py-4 text-sm font-black uppercase tracking-widest text-background transition-all duration-300 hover:scale-[1.03] hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, #00F5FF 0%, #7C3AED 100%)',
                boxShadow: '0 0 40px rgba(0,245,255,0.35), 0 0 12px rgba(124,58,237,0.40)',
              }}
            >
              <Sparkles className="h-4 w-4" />
              Launch Terminal
            </Link>
            <Link
              href="/analyzer"
              className="inline-flex items-center gap-3 rounded-xl border border-border-strong px-8 py-4 text-sm font-black uppercase tracking-widest text-text hover:border-neon/40 hover:bg-neon/5 transition-all duration-300"
            >
              <BarChart3 className="h-4 w-4 text-neon" />
              Analyze a Mint
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map(s => (
            <div
              key={s.label}
              className="hover-lift flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface/60 backdrop-blur-sm p-5 text-center"
            >
              <s.icon className="h-5 w-5 text-neon" />
              <p className="stat-value text-3xl font-black tracking-tight text-text">{s.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Trust strip */}
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[11px] font-semibold uppercase tracking-widest text-muted/70">
          <span>Security scoring by GoPlus</span>
          <span className="h-1 w-1 rounded-full bg-muted/40" />
          <span>Ethereum</span>
          <span className="h-1 w-1 rounded-full bg-muted/40" />
          <span>Base</span>
          <span className="h-1 w-1 rounded-full bg-muted/40" />
          <span>Arbitrum</span>
          <span className="h-1 w-1 rounded-full bg-muted/40" />
          <span>Polygon</span>
          <span className="h-1 w-1 rounded-full bg-muted/40" />
          <span>+11 more chains</span>
        </div>

        {/* Feature grid */}
        <div className="grid gap-5 md:grid-cols-2">
          {features.map(f => (
            <Link
              key={f.title}
              href={f.href}
              className="hover-lift group relative overflow-hidden rounded-2xl border p-7 transition-all duration-300 hover:scale-[1.02]"
              style={{
                background: `radial-gradient(ellipse at 20% 20%, ${f.glow.replace('0.', '0.08')} 0%, transparent 60%), rgba(8,12,20,0.80)`,
                borderColor: f.border.replace('border-', ''),
                boxShadow: `0 0 0 1px rgba(255,255,255,0.03)`,
              }}
            >
              {/* Top glow line */}
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{ background: `linear-gradient(90deg, transparent, ${f.glow}, transparent)` }}
              />

              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl border ${f.border} ${f.bg} transition-all duration-300 group-hover:scale-110`}
                    style={{ boxShadow: f.glow }}
                  >
                    <f.icon className={`h-6 w-6 ${f.accent}`} />
                  </div>
                  <h2 className="text-xl font-black tracking-tight text-text">{f.title}</h2>
                </div>
                <p className="text-sm text-secondary leading-relaxed">{f.description}</p>
                <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${f.accent}`}>
                  <span>Enter Module</span>
                  <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
