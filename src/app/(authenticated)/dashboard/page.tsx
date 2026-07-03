import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Activity, ArrowRight, CheckCircle2,
  Flame, Gauge, Radio, ShieldCheck, Target,
  Wallet, Zap, Eye, Cpu,
} from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { Stagger, StaggerItem, Reveal } from '@/components/motion';
import { MintActivityChart } from '@/components/dashboard/mint-activity-chart';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { captureException } from '@/lib/observability/sentry';
import { wallets, collections, mintHistory } from '@/drizzle/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { getUserMintTasks } from '@/lib/services/mint.service';
import { getRecentActivities } from '@/lib/monitoring';
import { getNativeTokenUsdPrice, formatUsd } from '@/lib/services/native-price.service';

async function getDashboardData(userId: string) {
  const last7Labels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  try {
    const db = getDb();
    const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [tasks, recentHistory, userWallets, userCollections, activities] = await Promise.all([
      getUserMintTasks(userId),
      db.select().from(mintHistory).where(and(gte(mintHistory.createdAt, since7Days), eq(mintHistory.userId, userId))).orderBy(desc(mintHistory.createdAt)),
      db.select().from(wallets).where(eq(wallets.userId, userId)),
      db.select().from(collections).where(eq(collections.userId, userId)),
      getRecentActivities(userId).catch(() => []),
    ]);

    const fundedWallets = userWallets.filter(w => w.balance && parseFloat(w.balance) > 0.001);
    const historyByDay = recentHistory.reduce((acc, h) => {
      const day = new Date(h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!acc[day]) acc[day] = { completed: 0, failed: 0 };
      if (h.status === 'confirmed') acc[day].completed++;
      else if (h.status === 'failed') acc[day].failed++;
      return acc;
    }, {} as Record<string, { completed: number; failed: number }>);

    const chartData = last7Labels.map(day => ({ day, completed: historyByDay[day]?.completed ?? 0, failed: historyByDay[day]?.failed ?? 0 }));

    let portfolioEth = 0;
    for (const w of userWallets) {
      if (w.balance) { const v = parseFloat(w.balance); if (Number.isFinite(v) && v > 0) portfolioEth += v; }
    }
    const ethUsdPrice = await getNativeTokenUsdPrice('ethereum').catch(() => 2500);
    const portfolioUsdValue = portfolioEth * ethUsdPrice;

    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const pendingTasks = tasks.filter(t => ['pending', 'monitoring', 'ready'].includes(t.status)).length;
    const failedTasks = tasks.filter(t => t.status === 'failed').length;

    return {
      tasks, completedTasks, pendingTasks, failedTasks,
      walletCount: userWallets.length, fundedWalletCount: fundedWallets.length,
      collectionCount: userCollections.length, recentHistory,
      chartData, activities, portfolioEth, portfolioUsdValue, ethUsdPrice,
    };
  } catch (e) {
    captureException(e);
    return {
      tasks: [], completedTasks: 0, pendingTasks: 0, failedTasks: 0,
      walletCount: 0, fundedWalletCount: 0, collectionCount: 0, recentHistory: [],
      chartData: last7Labels.map(day => ({ day, completed: 0, failed: 0 })),
      activities: [], portfolioEth: 0, portfolioUsdValue: 0, ethUsdPrice: 0,
    };
  }
}

function statusConfig(status: string) {
  switch (status) {
    case 'completed': return { variant: 'success' as const, label: 'Completed', dot: true, pulse: false };
    case 'confirmed': return { variant: 'success' as const, label: 'Confirmed', dot: true, pulse: false };
    case 'pending':   return { variant: 'warning' as const, label: 'Pending', dot: true, pulse: true };
    case 'monitoring':return { variant: 'neon' as const,    label: 'Monitoring', dot: true, pulse: true };
    case 'failed':    return { variant: 'danger' as const,  label: 'Failed', dot: true, pulse: false };
    default:           return { variant: 'default' as const, label: status, dot: false, pulse: false };
  }
}

export default async function DashboardPage() {
  const authResult = await requireApiUser();
  if ('error' in authResult) redirect('/sign-in');
  const d = await getDashboardData(authResult.userId);

  const totalMints = d.completedTasks + d.pendingTasks + d.failedTasks;
  const successRate = totalMints > 0 ? Math.round((d.completedTasks / totalMints) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title="Mission Control"
        subtitle="Live NFT minting intelligence dashboard"
        icon={Cpu}
        iconTone="neon"
        actions={
          <Link
            href="/mints"
            className="inline-flex items-center gap-2 rounded-xl border border-neon/30 bg-neon/5 px-4 py-2 text-sm font-bold tracking-tight text-neon hover:bg-neon/10 hover:border-neon/50 transition-all duration-200"
            style={{ boxShadow: '0 0 20px rgba(0,255,136,0.15)' }}
          >
            <Zap className="h-3.5 w-3.5" />
            New Mint
          </Link>
        }
      />

      {/* Metrics */}
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem><MetricCard label="Active Mints" value={d.pendingTasks} detail="Queued & monitoring" icon={Radio} tone="neon" /></StaggerItem>
        <StaggerItem><MetricCard label="Completed" value={d.completedTasks} detail={`${successRate}% success rate`} icon={CheckCircle2} tone="success" /></StaggerItem>
        <StaggerItem><MetricCard label="Portfolio ETH" value={`${d.portfolioEth.toFixed(3)} ETH`} detail={formatUsd(d.portfolioUsdValue)} icon={Wallet} tone="gold" /></StaggerItem>
        <StaggerItem><MetricCard label="Collections" value={d.collectionCount} detail={`${d.fundedWalletCount} funded wallets`} icon={Target} tone="primary" /></StaggerItem>
      </Stagger>

      {/* Main grid */}
      <Reveal className="grid gap-6 lg:grid-cols-3">

        {/* 7-day chart */}
        <Card tone="neon" className="p-6 lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">7-Day Mint Activity</p>
              <p className="mt-1 text-2xl font-black text-text">{d.recentHistory.length} Mints</p>
            </div>
            <Badge variant="neon" dot pulse>Live</Badge>
          </div>
          <MintActivityChart data={d.chartData} />
        </Card>

        {/* System health */}
        <Card tone="neon" className="p-6">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">System Health</p>
          <div className="space-y-3">
            {[
              { label: 'RPC Providers', status: 'Operational', icon: CheckCircle2, color: 'text-success' },
              { label: 'Analyzer Queue', status: 'Clear', icon: CheckCircle2, color: 'text-success' },
              { label: 'Gas Oracle', status: 'Active', icon: Flame, color: 'text-warning' },
              { label: 'Mint Monitor', status: 'Watching', icon: Radio, color: 'text-neon' },
              { label: 'Risk Engine', status: 'Online', icon: ShieldCheck, color: 'text-success' },
            ].map(s => (
              <div key={s.label} className="flex items-center justify-between rounded-lg bg-background/50 px-3 py-2.5">
                <span className="text-xs text-secondary">{s.label}</span>
                <div className="flex items-center gap-1.5">
                  <s.icon className={`h-3 w-3 ${s.color}`} />
                  <span className={`text-[10px] font-bold ${s.color}`}>{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Reveal>

      {/* Recent activity */}
      <Reveal>
      <Card tone="neon" className="p-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-4 w-4 text-neon" />
            <p className="text-sm font-black text-text">Recent Mint Activity</p>
          </div>
          <Link href="/history" className="flex items-center gap-1.5 text-xs text-neon hover:text-neon/80 transition-colors">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {d.recentHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface">
              <Zap className="h-6 w-6 text-muted" />
            </div>
            <p className="text-sm font-bold text-text">No mints yet</p>
            <p className="text-xs text-muted">Your mint history will appear here</p>
            <Link href="/mints" className="mt-2 inline-flex items-center gap-2 rounded-lg border border-neon/30 bg-neon/5 px-4 py-2 text-xs font-bold text-neon hover:bg-neon/10 transition-colors">
              <Zap className="h-3 w-3" />Queue your first mint
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {d.recentHistory.slice(0, 8).map(h => {
              const sc = statusConfig(h.status);
              return (
                <div key={h.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface">
                    <Zap className="h-4 w-4 text-neon" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text truncate">
                      {'contractAddress' in h && h.contractAddress ? `${(h.contractAddress as string).slice(0, 6)}…${(h.contractAddress as string).slice(-4)}` : `Mint #${h.id.slice(-6)}`}
                    </p>
                    <p className="text-xs text-muted">
                      {new Date(h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <Badge variant={sc.variant} dot={sc.dot} pulse={sc.pulse}>{sc.label}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      </Reveal>

      {/* Quick actions */}
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" inView>
        {[
          { href: '/analyzer',      icon: Gauge,     label: 'Analyze Mint',    desc: 'AI contract scan',      tone: 'text-neon',    glow: 'rgba(0,255,136,0.20)',    border: 'border-neon/20' },
          { href: '/collections',   icon: Target,    label: 'Collections',     desc: 'Manage watchlist',    tone: 'text-primary', glow: 'rgba(0,255,136,0.20)', border: 'border-primary/20' },
          { href: '/wallets',       icon: Wallet,    label: 'Wallets',          desc: 'Fund & configure',    tone: 'text-success', glow: 'rgba(0,255,136,0.20)', border: 'border-success/20' },
          { href: '/whale-tracker', icon: Eye,       label: 'Whale Tracker',   desc: 'Follow smart money',  tone: 'text-gold',    glow: 'rgba(240,169,59,0.20)',  border: 'border-gold/20' },
        ].map(a => (
          <StaggerItem key={a.href}>
          <Link
            href={a.href}
            className="group flex h-full items-center gap-4 rounded-xl border bg-surface p-4 hover:bg-surface-hover transition-all duration-200 hover:scale-[1.02]"
            style={{ borderColor: a.border.replace('border-', ''), boxShadow: `0 0 20px transparent` }}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 group-hover:scale-110"
              style={{ borderColor: a.border.replace('border-', ''), boxShadow: a.glow }}
            >
              <a.icon className={`h-4 w-4 ${a.tone}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-text">{a.label}</p>
              <p className="text-xs text-muted">{a.desc}</p>
            </div>
            <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
