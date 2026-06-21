import {
  Activity,
  AlertTriangle,
  Clock3,
  Gauge,
  ShieldCheck,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getAnalyticsDashboard, type ChartPoint } from '@/lib/services/analytics.service';

function formatPercent(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function formatEth(value: number) {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: value === 0 ? 0 : 3,
    maximumFractionDigits: 4,
  })} ETH`;
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatLatency(ms: number) {
  if (ms <= 0) return '0ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function maxValue(points: ChartPoint[]) {
  return Math.max(1, ...points.flatMap((point) => [point.value, point.secondary ?? 0]));
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Activity; title: string; description: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold text-text">{title}</h2>
        <p className="mt-1 text-wrap text-sm leading-6 text-muted">{description}</p>
      </div>
    </div>
  );
}

function StatGrid({ items }: { items: Array<{ label: string; value: string | number; detail?: string }> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-lg border border-border bg-background/60 p-4">
          <p className="text-wrap text-xs font-medium uppercase text-muted">{item.label}</p>
          <p className="mt-2 break-words font-mono text-2xl font-semibold text-text">{item.value}</p>
          {item.detail ? <p className="mt-1 text-xs text-muted">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}

function BarChart({ points, dual = false }: { points: ChartPoint[]; dual?: boolean }) {
  const max = maxValue(points);

  return (
    <div className="h-44 min-w-0 overflow-hidden rounded-lg border border-border bg-background/60 p-4">
      <div className="flex h-32 min-w-0 items-end gap-2">
        {points.map((point) => (
          <div key={point.label} className="group flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex h-28 w-full items-end gap-1">
              <div
                className="w-full rounded-t bg-accent/75 transition group-hover:bg-accent"
                style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
                title={`${point.label}: ${point.value}`}
              />
              {dual && point.secondary !== undefined ? (
                <div
                  className="w-full rounded-t bg-success/70 transition group-hover:bg-success"
                  style={{ height: `${Math.max(4, (point.secondary / max) * 100)}%` }}
                  title={`${point.label}: ${point.secondary} successful`}
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

function OutcomeBars({ points }: { points: ChartPoint[] }) {
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <div className="min-w-0 space-y-3">
      {points.map((point) => {
        const width = total > 0 ? (point.value / total) * 100 : 0;
        const isFailure = point.label.toLowerCase().includes('failed');
        return (
          <div key={point.label}>
            <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-muted">{point.label}</span>
              <span className="font-mono text-text">{point.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/5">
              <div className={`h-full rounded-full ${isFailure ? 'bg-danger' : 'bg-success'}`} style={{ width: `${Math.max(total > 0 ? 4 : 0, width)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function AnalyticsPage() {
  const auth = await requireApiUser();
  if ('error' in auth) redirect('/sign-in');

  const analytics = await getAnalyticsDashboard(auth.userId);

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Mint Analytics"
        description="User-owned mint performance, execution speed, spend, risk, and scheduled mint outcomes."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Mints" value={analytics.kpis.totalMints} detail={`${analytics.kpis.successfulMints} successful`} icon={Zap} tone="primary" />
        <MetricCard label="Success Rate" value={formatPercent(analytics.kpis.successRate)} detail={`${analytics.kpis.failedMints} failed mints`} icon={TrendingUp} tone="success" />
        <MetricCard label="Scheduled Mints" value={analytics.kpis.scheduledMints} detail={`${analytics.kpis.executedScheduledMints} executed`} icon={Clock3} tone="accent" />
        <MetricCard label="Risk Average" value={analytics.kpis.averageRiskScore} detail={`${analytics.kpis.highRiskCollections} high risk`} icon={ShieldCheck} tone={analytics.kpis.averageRiskScore >= 51 ? 'warning' : 'success'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-5">
          <SectionHeader icon={Clock3} title="Execution Performance" description="Timing from task creation to confirmation, with RPC latency from user-scoped RPC execution events." />
          <StatGrid
            items={[
              { label: 'Average Execution Time', value: formatDuration(analytics.executionPerformance.averageExecutionTimeSeconds) },
              { label: 'Fastest Execution', value: formatDuration(analytics.executionPerformance.fastestExecutionSeconds) },
              { label: 'Slowest Execution', value: formatDuration(analytics.executionPerformance.slowestExecutionSeconds) },
              { label: 'Average RPC Latency', value: formatLatency(analytics.executionPerformance.averageRpcLatencyMs) },
            ]}
          />
        </Card>

        <Card className="min-w-0 p-5">
          <SectionHeader icon={Gauge} title="Mint Performance" description="Execution outcomes from your mint task and mint history records." />
          <StatGrid
            items={[
              { label: 'Successful Mints', value: analytics.mintPerformance.successfulMints },
              { label: 'Failed Mints', value: analytics.mintPerformance.failedMints },
              { label: 'Success Rate', value: formatPercent(analytics.mintPerformance.successRate) },
            ]}
          />
          <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(150px,0.75fr)]">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase text-muted">Mints Over Time</p>
              <BarChart points={analytics.mintPerformance.mintsOverTime} dual />
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase text-muted">Success vs Failure</p>
              <OutcomeBars points={analytics.mintPerformance.successVsFailure} />
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card tone="elevated" className="min-w-0 p-5">
          <SectionHeader icon={Wallet} title="Profit & Spend Analytics" description="Spending totals from executed mint records, including mint price and recorded gas usage when available." />
          <StatGrid
            items={[
              { label: 'Total Spend', value: formatEth(analytics.spendAnalytics.totalSpendEth) },
              { label: 'Average Mint Cost', value: formatEth(analytics.spendAnalytics.averageMintCostEth) },
              { label: 'Highest Mint Cost', value: formatEth(analytics.spendAnalytics.highestMintCostEth) },
              { label: 'Lowest Mint Cost', value: formatEth(analytics.spendAnalytics.lowestMintCostEth) },
            ]}
          />
        </Card>

        <Card className="min-w-0 p-5">
          <SectionHeader icon={AlertTriangle} title="Risk Analytics" description="Analyzer risk distribution from stored risk scores on your collection mint tasks." />
          <StatGrid
            items={[
              { label: 'Collections Analyzed', value: analytics.riskAnalytics.collectionsAnalyzed },
              { label: 'Average Risk Score', value: analytics.riskAnalytics.averageRiskScore },
              { label: 'Low Risk Count', value: analytics.riskAnalytics.lowRiskCount, detail: '0-25' },
              { label: 'Medium Risk Count', value: analytics.riskAnalytics.mediumRiskCount, detail: '26-50' },
              { label: 'High Risk Count', value: analytics.riskAnalytics.highRiskCount, detail: '51-75' },
              { label: 'Critical Risk Count', value: analytics.riskAnalytics.criticalRiskCount, detail: '76-100' },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
