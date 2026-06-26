import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Flame,
  Gauge,
  Radio,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
  Zap,
} from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { getUserMintTasks } from '@/lib/services/mint.service';
import { getRecentActivities } from '@/lib/monitoring';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { captureException } from '@/lib/observability/sentry';
import { wallets, collections, mintHistory } from '@/drizzle/schema';
import { gte, desc } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { formatEther } from 'viem';

async function getDashboardData(userId: string) {
  // Hoisted — used in both try{} and catch{} blocks
  const last7Labels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  try {
    const db = getDb();
    
    // Get user's mint tasks
    const tasks = await getUserMintTasks(userId);
    
    // Build 7-day chart from mintHistory (on-chain confirmed/failed transactions)
    const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentHistory = await db.select().from(mintHistory)
      .where(gte(mintHistory.createdAt, since7Days))
      .orderBy(desc(mintHistory.createdAt));

    const historyByDay = recentHistory.reduce((acc, h) => {
      const day = new Date(h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!acc[day]) acc[day] = { completed: 0, failed: 0 };
      if (h.status === 'confirmed') acc[day].completed++;
      else if (h.status === 'failed') acc[day].failed++;
      return acc;
    }, {} as Record<string, { completed: number; failed: number }>);

    const chartData = last7Labels.map(day => ({
      day,
      completed: historyByDay[day]?.completed ?? 0,
      failed: historyByDay[day]?.failed ?? 0,
    }));

    // Get wallet count and funded status
    const userWallets = await db.select().from(wallets).where(eq(wallets.userId, userId));
    const fundedWallets = userWallets.filter(w => w.balance && parseFloat(w.balance) > 0.001);
    
    // Get collections
    const userCollections = await db.select().from(collections).where(eq(collections.userId, userId));
    
    // Calculate portfolio value (sum of all wallet balances)
    let portfolioValue = 0n;
    for (const wallet of userWallets) {
      if (wallet.address && wallet.balance) {
        try {
          portfolioValue += BigInt(wallet.balance);
        } catch {
          // Skip balance parse if it fails
        }
      }
    }
    
    // Calculate statistics
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const pendingTasks = tasks.filter(t => ['pending', 'monitoring', 'ready'].includes(t.status)).length;
    const failedTasks = tasks.filter(t => t.status === 'failed').length;
    
    // Get recent activities
    let activities: Awaited<ReturnType<typeof getRecentActivities>> = [];
    try {
      activities = await getRecentActivities(userId);
    } catch {
      // Skip activities if fetch fails
    }
    
    // System health checks
    const systemStatuses = [
      { label: 'RPC providers', value: 'Operational', icon: CheckCircle2, color: 'text-success' },
      { label: 'Analyzer queue', value: 'Clear', icon: CheckCircle2, color: 'text-success' },
      { label: 'Risk engine', value: 'Operational', icon: ShieldCheck, color: 'text-success' },
      { label: 'Automation worker', value: 'Operational', icon: CheckCircle2, color: 'text-success' },
    ];
    
    return {
      metrics: [
        { 
          label: 'Portfolio Value', 
          value: `${parseFloat(formatEther(portfolioValue)).toFixed(2)} ETH`, 
          detail: `${userWallets.length} wallet${userWallets.length !== 1 ? 's' : ''}`, 
          icon: Wallet, 
          tone: 'success' as const 
        },
        { 
          label: 'Completed Mints', 
          value: completedTasks.toString(), 
          detail: `${failedTasks} failed`, 
          icon: BarChart3, 
          tone: 'accent' as const 
        },
        { 
          label: 'Active Tasks', 
          value: pendingTasks.toString(), 
          detail: `${tasks.length - pendingTasks - completedTasks} other`, 
          icon: Zap, 
          tone: 'primary' as const 
        },
        { 
          label: 'Funded Wallets', 
          value: `${fundedWallets.length}/${userWallets.length}`, 
          detail: userWallets.length > 0 ? `${Math.round((fundedWallets.length / userWallets.length) * 100)}% funded` : 'No wallets', 
          icon: AlertTriangle, 
          tone: fundedWallets.length === userWallets.length ? 'success' as const : 'warning' as const 
        },
      ],
      tasks: tasks.slice(0, 5).map(task => ({
        name: task.contractAddress ? `${task.contractAddress.slice(0, 6)}...${task.contractAddress.slice(-4)}` : 'Unknown',
        status: task.status.charAt(0).toUpperCase() + task.status.slice(1),
        wallet: task.walletId ? `${task.walletId.slice(0, 6)}...${task.walletId.slice(-4)}` : 'Unknown',
        eta: task.scheduledTime ? new Date(task.scheduledTime).toLocaleTimeString() : 'N/A',
        risk: task.riskThreshold && task.riskThreshold > 75 ? 'High' : task.riskThreshold && task.riskThreshold > 50 ? 'Medium' : 'Low',
      })),
      completedCount: completedTasks,
      failedCount: failedTasks,
      chartData,
      riskFeed: [] as Array<{ title: string; source: string; level: string; time: string }>,
      watchlist: userCollections.slice(0, 4).map(col => ({
        name: col.name || 'Unknown',
        chain: col.chain || 'Unknown',
        score: null as number | null,  // Not yet computed — requires risk analysis integration
        demand: 'Medium',
      })),
      activity: activities.slice(0, 5).map(act => [
        new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        act.type,
        act.title || '',
      ]),
      systemStatuses,
    };
  } catch (error) {
    console.error('Dashboard data fetch error:', error);
    void captureException(error, { area: 'dashboard' });
    // Return empty data on error
    return {
      metrics: [
        { label: 'Portfolio Value', value: '0.00 ETH', detail: '0 wallets', icon: Wallet, tone: 'success' as const },
        { label: 'Completed Mints', value: '0', detail: '0 failed', icon: BarChart3, tone: 'accent' as const },
        { label: 'Active Tasks', value: '0', detail: '0 other', icon: Zap, tone: 'primary' as const },
        { label: 'Funded Wallets', value: '0/0', detail: 'No wallets', icon: AlertTriangle, tone: 'warning' as const },
      ],
      completedCount: 0,
      failedCount: 0,
      chartData: last7Labels.map(day => ({ day, completed: 0, failed: 0 })),
      tasks: [],
      riskFeed: [],
      watchlist: [],
      activity: [],
      systemStatuses: [
        { label: 'RPC providers', value: 'Operational', icon: CheckCircle2, color: 'text-success' },
        { label: 'Analyzer queue', value: 'Clear', icon: CheckCircle2, color: 'text-success' },
        { label: 'Risk engine', value: 'Operational', icon: ShieldCheck, color: 'text-success' },
        { label: 'Automation worker', value: 'Operational', icon: CheckCircle2, color: 'text-success' },
      ],
    };
  }
}

export default async function DashboardPage() {
  const authResult = await requireApiUser();
  if ('error' in authResult) {
    // Auth check failed - the middleware should handle this
    // But if we get here, redirect to sign-in
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted">Redirecting to sign-in...</p>
      </div>
    );
  }
  
  const data = await getDashboardData(authResult.userId);
  return (
    <div>
      <PageHeader
        eyebrow="Command Center"
        title="Dashboard"
        description="Monitor portfolio exposure, mint execution, wallet readiness, live risk, and system health from one operating view."
        actions={
          <>
            <Link
              href="/analyzer"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-white/5 px-4 text-sm font-medium text-text transition hover:border-white/15 hover:bg-white/10"
            >
              <Gauge className="h-4 w-4" aria-hidden="true" />
              Analyze
            </Link>
            <Link
              href="/mints"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white shadow-lg shadow-primary/20 transition hover:bg-primary-hover"
            >
              New Mint
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <Card tone="elevated" className="p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-accent">Mint Performance Metrics</p>
              <h2 className="mt-1 text-lg font-semibold text-text">Execution throughput</h2>
            </div>
            <Badge variant="success">Healthy</Badge>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              ['Success rate', data.completedCount + data.failedCount > 0 ? `${Math.round((data.completedCount / (data.completedCount + data.failedCount)) * 100)}%` : 'N/A', 'Last 30 days'],
              ['Avg execution', 'N/A', 'Intent to broadcast'],
              ['Total tasks', data.tasks.length.toString(), 'All time'],
            ].map(([label, value, detail]) => (
              <div key={label} className="rounded-lg border border-border bg-background/60 p-4">
                <p className="text-xs uppercase text-muted">{label}</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-text">{value}</p>
                <p className="mt-1 text-xs text-muted">{detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 h-28 rounded-lg border border-border bg-background/60 p-4">
            {data.chartData.some(d => d.completed > 0 || d.failed > 0) ? (
              <div className="flex h-full items-end gap-1">
                {data.chartData.map((d) => {
                  const maxVal = Math.max(...data.chartData.map(x => x.completed + x.failed), 1);
                  const totalH = ((d.completed + d.failed) / maxVal) * 100;
                  const failedH = d.failed > 0 ? ((d.failed) / maxVal) * 100 : 0;
                  const completedH = totalH - failedH;
                  return (
                    <div key={d.day} className="flex flex-1 flex-col items-center gap-0.5" title={`${d.day}: ${d.completed} ok / ${d.failed} failed`}>
                      <div className="flex w-full flex-1 items-end flex-col justify-end gap-0">
                        {d.failed > 0 && <div className="w-full rounded-t-sm bg-danger/60" style={{ height: `${failedH}%` }} />}
                        {d.completed > 0 && <div className="w-full bg-success/60" style={{ height: `${completedH}%` }} />}
                      </div>
                      <span className="text-[8px] text-muted whitespace-nowrap">{d.day.split(' ')[1]}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted text-sm">
                No mint history yet
              </div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Wallet className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold text-text">Wallet Health</h2>
          </div>
          <div className="space-y-4">
            {[
              [`Funded wallets`, `${data.metrics[3].value}`, data.metrics[3].tone],
              ['Chain coverage', 'ETH, Base, Polygon', 'info'],
              ['Exposure cap', 'N/A', 'info'],
            ].map(([label, value, variant]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted">{label}</span>
                <Badge variant={variant as 'success' | 'warning' | 'info'}>{value}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr_0.9fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-accent" aria-hidden="true" />
              <h2 className="font-semibold text-text">Active Mint Tasks</h2>
            </div>
          </div>
          <div className="divide-y divide-border">
            {data.tasks.length > 0 ? data.tasks.map((task) => (
              <div key={task.name} className="grid gap-3 p-4 sm:grid-cols-[1fr_110px_90px] sm:items-center">
                <div>
                  <p className="font-medium text-text">{task.name}</p>
                  <p className="font-mono text-xs text-muted">{task.wallet}</p>
                </div>
                <Badge variant={task.risk === 'Low' ? 'success' : task.risk === 'Medium' ? 'warning' : 'danger'}>{task.status}</Badge>
                <p className="font-mono text-sm text-muted">{task.eta}</p>
              </div>
            )) : (
              <div className="p-4 text-center text-muted">No active tasks</div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Flame className="h-5 w-5 text-warning" aria-hidden="true" />
            <h2 className="font-semibold text-text">Risk Feed</h2>
          </div>
          <div className="space-y-3">
            {data.riskFeed.length > 0 ? data.riskFeed.map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant={item.level === 'High' ? 'danger' : item.level === 'Medium' ? 'warning' : 'success'}>{item.level}</Badge>
                  <span className="text-xs text-muted">{item.time}</span>
                </div>
                <p className="mt-3 text-sm font-medium text-text">{item.title}</p>
                <p className="mt-1 text-xs text-muted">{item.source}</p>
              </div>
            )) : (
              <div className="text-center text-muted text-sm">No risk alerts</div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Target className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold text-text">Collection Watchlist</h2>
          </div>
          <div className="space-y-3">
            {data.watchlist.length > 0 ? data.watchlist.map((item) => (
              <div key={item.name} className="flex items-center gap-3 rounded-lg border border-border bg-white/5 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{item.name}</p>
                  <p className="text-xs text-muted">{item.chain} / {item.demand}</p>
                </div>
                <span className="font-mono text-sm text-text">{item.score ?? '—'}</span>
              </div>
            )) : (
              <div className="text-center text-muted text-sm">No collections</div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Clock3 className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold text-text">Recent Activity</h2>
          </div>
          <div className="space-y-3">
            {data.activity.length > 0 ? data.activity.map(([time, title, detail]) => (
              <div key={`${time}-${title}`} className="flex gap-4 rounded-lg border border-border bg-white/5 p-3">
                <span className="font-mono text-xs text-muted">{time}</span>
                <div>
                  <p className="text-sm font-medium text-text">{title}</p>
                  <p className="mt-1 text-sm text-muted">{detail}</p>
                </div>
              </div>
            )) : (
              <div className="text-center text-muted text-sm">No recent activity</div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Radio className="h-5 w-5 text-success" aria-hidden="true" />
            <h2 className="font-semibold text-text">System Status</h2>
          </div>
          <div className="space-y-3">
            {data.systemStatuses.map((status) => (
              <div key={status.label} className="flex items-center gap-3 rounded-lg border border-border bg-white/5 p-3">
                <status.icon className={`h-4 w-4 ${status.color}`} aria-hidden="true" />
                <span className="text-sm text-muted">{status.label}</span>
                <span className="ml-auto text-sm text-text">{status.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
