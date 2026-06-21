import { auth } from '@clerk/nextjs/server';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Clock3,
  Gauge,
  Radio,
  ShieldCheck,
  Target,
  TrendingUp,
  Wallet,
  Waves,
  Zap,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { syncUser } from '@/lib/auth/sync-user';
import { getAnalyticsDashboard } from '@/lib/services/analytics.service';

function formatPercent(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function formatMs(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

function maxValue(points: Array<{ value: number; secondary?: number }>) {
  return Math.max(1, ...points.flatMap((point) => [point.value, point.secondary ?? 0]));
}

function BarChart({
  points,
  kind = 'default',
}: {
  points: Array<{ label: string; value: number; secondary?: number }>;
  kind?: 'default' | 'percent' | 'latency';
}) {
  const max = kind === 'percent' ? 100 : maxValue(points);

  return (
    <div className="h-40 rounded-lg border border-border bg-background/60 p-4">
      <div className="flex h-28 items-end gap-2">
        {points.map((point) => (
          <div key={point.label} className="group flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex h-24 w-full items-end gap-1">
              <div
                className="w-full rounded-t bg-accent/75 transition group-hover:bg-accent"
                style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
              />
              {point.secondary !== undefined ? (
                <div
                  className="w-full rounded-t bg-success/70 transition group-hover:bg-success"
                  style={{ height: `${Math.max(4, (point.secondary / max) * 100)}%` }}
                />
              ) : null}
            </div>
            <span className="truncate font-mono text-[10px] text-muted">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DistributionChart({ points }: { points: Array<{ label: string; value: number }> }) {
  const max = maxValue(points);
  return (
    <div className="space-y-3">
      {points.map((point) => (
        <div key={point.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted">{point.label}</span>
            <span className="font-mono text-text">{point.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-warning" style={{ width: `${Math.max(3, (point.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: typeof Activity; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
      <h2 className="font-semibold text-text">{title}</h2>
    </div>
  );
}

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session.userId) redirect('/sign-in');

  const user = await syncUser(session.userId);
  if (!user) redirect('/sign-in');

  const analytics = await getAnalyticsDashboard(user.id);

  return (
    <div>
      <PageHeader
        eyebrow="Telemetry"
        title="Analytics"
        description="Production metrics for mint outcomes, scheduled execution, discovery, risk, wallet tracking, consensus, and infrastructure health."
        actions={<Badge variant="info">Updated {new Date(analytics.generatedAt).toLocaleTimeString()}</Badge>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Mints" value={analytics.mintMetrics.totalMints} detail={`${analytics.mintMetrics.successfulMints} successful`} icon={Zap} tone="primary" />
        <MetricCard label="Success Rate" value={formatPercent(analytics.mintMetrics.successRate)} detail={`${analytics.mintMetrics.failedMints} failed mints`} icon={TrendingUp} tone="success" />
        <MetricCard label="Scheduled Mints" value={analytics.schedulingMetrics.scheduledMints} detail={`${analytics.schedulingMetrics.executedMints} executed`} icon={Clock3} tone="accent" />
        <MetricCard label="Risk Average" value={analytics.riskMetrics.averageRiskScore} detail={`${analytics.riskMetrics.highRiskCount} high risk`} icon={ShieldCheck} tone={analytics.riskMetrics.averageRiskScore >= 50 ? 'warning' : 'success'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card tone="elevated" className="p-5">
          <SectionHeader icon={BarChart3} title="Overview" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-background/60 p-4">
              <p className="text-xs uppercase text-muted">Executed</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-text">{analytics.schedulingMetrics.executedMints}</p>
              <p className="mt-1 text-xs text-muted">Scheduled mints completed</p>
            </div>
            <div className="rounded-lg border border-border bg-background/60 p-4">
              <p className="text-xs uppercase text-muted">Cancelled</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-text">{analytics.schedulingMetrics.cancelledMints}</p>
              <p className="mt-1 text-xs text-muted">Stopped before execution</p>
            </div>
            <div className="rounded-lg border border-border bg-background/60 p-4">
              <p className="text-xs uppercase text-muted">Low Risk</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-text">{analytics.riskMetrics.lowRiskCount}</p>
              <p className="mt-1 text-xs text-muted">Scores below 50</p>
            </div>
          </div>
          <div className="mt-5">
            <BarChart points={analytics.charts.dailyMints} />
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader icon={Gauge} title="Mint Performance" />
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">Success rate</span>
                <span className="font-mono text-text">{formatPercent(analytics.mintMetrics.successRate)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-success" style={{ width: `${analytics.mintMetrics.successRate}%` }} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-white/5 p-3">
                <p className="text-xs text-muted">Successful mints</p>
                <p className="mt-2 font-mono text-xl text-text">{analytics.mintMetrics.successfulMints}</p>
              </div>
              <div className="rounded-lg border border-border bg-white/5 p-3">
                <p className="text-xs text-muted">Failed mints</p>
                <p className="mt-2 font-mono text-xl text-text">{analytics.mintMetrics.failedMints}</p>
              </div>
            </div>
            <BarChart points={analytics.charts.successRate} kind="percent" />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="p-5">
          <SectionHeader icon={Target} title="Discovery Performance" />
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <MetricCard label="Jina Success" value={formatPercent(analytics.discoveryMetrics.jinaSuccessRate)} icon={Bot} tone="accent" />
              <MetricCard label="Firecrawl Success" value={formatPercent(analytics.discoveryMetrics.firecrawlSuccessRate)} icon={Waves} tone="primary" />
              <MetricCard label="Avg Discovery" value={formatMs(analytics.discoveryMetrics.averageDiscoveryTime)} icon={Clock3} tone="muted" />
            </div>
            <BarChart points={analytics.charts.discoveryLatency} kind="latency" />
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader icon={Wallet} title="Wallet Tracking" />
          <div className="grid gap-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-white/5 p-3">
              <span className="text-sm text-muted">Tracked wallets</span>
              <span className="font-mono text-text">{analytics.walletTrackerMetrics.trackedWallets}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-white/5 p-3">
              <span className="text-sm text-muted">Detected mints</span>
              <span className="font-mono text-text">{analytics.walletTrackerMetrics.detectedMints}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-white/5 p-3">
              <span className="text-sm text-muted">Copy mint triggers</span>
              <span className="font-mono text-text">{analytics.walletTrackerMetrics.copyMintTriggers}</span>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-border bg-background/60 p-4">
            <p className="mb-3 text-xs font-semibold uppercase text-muted">Whale Consensus</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Triggers</span>
                <span className="font-mono text-text">{analytics.whaleConsensusMetrics.consensusTriggers}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Consensus mints</span>
                <span className="font-mono text-text">{analytics.whaleConsensusMetrics.successfulConsensusMints}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Collections</span>
                <span className="font-mono text-text">{analytics.whaleConsensusMetrics.uniqueConsensusCollections}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader icon={AlertTriangle} title="Risk Distribution" />
          <DistributionChart points={analytics.charts.riskDistribution} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="p-5">
          <SectionHeader icon={Radio} title="Infrastructure Health" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-white/5 p-4">
              <p className="text-xs uppercase text-muted">RPC Usage</p>
              <div className="mt-4">
                <BarChart points={analytics.charts.rpcUsage} />
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted">Alchemy latency</span><span className="font-mono text-text">{formatMs(analytics.rpcMetrics.alchemyLatency)}</span></div>
                <div className="flex justify-between"><span className="text-muted">QuickNode latency</span><span className="font-mono text-text">{formatMs(analytics.rpcMetrics.quicknodeLatency)}</span></div>
                <div className="flex justify-between"><span className="text-muted">Failovers</span><span className="font-mono text-text">{analytics.rpcMetrics.failoverCount}</span></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-white/5 p-4">
                <p className="text-xs uppercase text-muted">QStash</p>
                <p className="mt-2 font-mono text-xl text-text">{analytics.qstashMetrics.jobsScheduled}</p>
                <p className="text-xs text-muted">{analytics.qstashMetrics.jobsExecuted} executed / {analytics.qstashMetrics.jobFailures} failed</p>
              </div>
              <div className="rounded-lg border border-border bg-white/5 p-4">
                <p className="text-xs uppercase text-muted">Telegram</p>
                <p className="mt-2 font-mono text-xl text-text">{analytics.telegramMetrics.messagesSent}</p>
                <p className="text-xs text-muted">{analytics.telegramMetrics.messageFailures} delivery failures</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <SectionHeader icon={Activity} title="Recent Analytics Events" />
          </div>
          <div className="divide-y divide-border">
            {analytics.recentEvents.length === 0 ? (
              <div className="p-5 text-sm text-muted">No recent events.</div>
            ) : analytics.recentEvents.map((event) => (
              <div key={event.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_150px] sm:items-center">
                <div>
                  <p className="text-sm font-medium text-text">{event.title}</p>
                  <p className="mt-1 text-xs text-muted">{event.type}</p>
                </div>
                <span className="font-mono text-xs text-muted">{new Date(event.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
