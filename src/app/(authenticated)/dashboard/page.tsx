import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
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

const metrics = [
  { label: 'Portfolio Value', value: '18.42 ETH', detail: '+6.8% this week', icon: Wallet, tone: 'success' as const },
  { label: 'Mint PnL', value: '+4.7 ETH', detail: 'Across 27 executed mints', icon: BarChart3, tone: 'accent' as const },
  { label: 'Active Tasks', value: '12', detail: '4 executing now', icon: Zap, tone: 'primary' as const },
  { label: 'Risk Alerts', value: '3', detail: '2 require approval', icon: AlertTriangle, tone: 'warning' as const },
];

const tasks = [
  { name: 'Eclipse Foundry', status: 'Executing', wallet: '0x71...c82a', eta: '02:14', risk: 'Low' },
  { name: 'Tensorian Seeds', status: 'Queued', wallet: '0xb9...118e', eta: '09:32', risk: 'Medium' },
  { name: 'Night Market Pass', status: 'Monitoring', wallet: '0x42...78fd', eta: '31:00', risk: 'Elevated' },
  { name: 'Base Arcade', status: 'Ready', wallet: '0x6d...a0f4', eta: '1h 12m', risk: 'Low' },
];

const riskFeed = [
  { title: 'Contract bytecode changed', source: 'Night Market Pass', level: 'High', time: '4m ago' },
  { title: 'Bot pressure crossed p90', source: 'Tensorian Seeds', level: 'Medium', time: '11m ago' },
  { title: 'Liquidity depth improved', source: 'Eclipse Foundry', level: 'Low', time: '18m ago' },
];

const watchlist = [
  { name: 'Mint Terminal', chain: 'Base', score: 89, demand: 'High' },
  { name: 'Ordinal Labs', chain: 'Ethereum', score: 82, demand: 'Medium' },
  { name: 'Aster Garden', chain: 'Solana', score: 78, demand: 'High' },
  { name: 'Frame Protocol', chain: 'Base', score: 74, demand: 'Moderate' },
];

const activity = [
  ['08:42', 'Strategy updated', 'Raised priority fee for Eclipse Foundry'],
  ['08:35', 'Wallet funded', '0xb9...118e received 0.42 ETH'],
  ['08:21', 'Risk blocked', 'Night Market requires manual approval'],
  ['08:12', 'Collection analyzed', 'Tensorian Seeds scored 91'],
];

const systemStatuses: Array<{
  label: string;
  value: string;
  icon: LucideIcon;
  color: string;
}> = [
  { label: 'RPC providers', value: 'Operational', icon: CheckCircle2, color: 'text-success' },
  { label: 'Analyzer queue', value: 'Clear', icon: CheckCircle2, color: 'text-success' },
  { label: 'Risk engine', value: 'Operational', icon: ShieldCheck, color: 'text-success' },
  { label: 'Automation worker', value: 'Degraded', icon: AlertTriangle, color: 'text-warning' },
];

export default function DashboardPage() {
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
        {metrics.map((metric) => (
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
              ['Success rate', '93.8%', 'Last 30 days'],
              ['Avg execution', '1.24s', 'Intent to broadcast'],
              ['Recovered retries', '18', 'Auto-healed tasks'],
            ].map(([label, value, detail]) => (
              <div key={label} className="rounded-lg border border-border bg-background/60 p-4">
                <p className="text-xs uppercase text-muted">{label}</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-text">{value}</p>
                <p className="mt-1 text-xs text-muted">{detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 h-28 rounded-lg border border-border bg-background/60 p-4">
            <div className="flex h-full items-end gap-2">
              {[44, 56, 38, 72, 64, 88, 70, 94, 82, 76, 91, 84].map((height, index) => (
                <div key={index} className="flex flex-1 items-end">
                  <div className="w-full rounded-t bg-accent/70" style={{ height: `${height}%` }} />
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Wallet className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold text-text">Wallet Health</h2>
          </div>
          <div className="space-y-4">
            {[
              ['Funded wallets', '12 / 14', 'success'],
              ['Nonce aligned', '10 / 12', 'warning'],
              ['Chain coverage', 'ETH, Base, Solana', 'info'],
              ['Exposure cap', '68% used', 'warning'],
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
            {tasks.map((task) => (
              <div key={task.name} className="grid gap-3 p-4 sm:grid-cols-[1fr_110px_90px] sm:items-center">
                <div>
                  <p className="font-medium text-text">{task.name}</p>
                  <p className="font-mono text-xs text-muted">{task.wallet}</p>
                </div>
                <Badge variant={task.risk === 'Low' ? 'success' : task.risk === 'Medium' ? 'warning' : 'danger'}>{task.status}</Badge>
                <p className="font-mono text-sm text-muted">{task.eta}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Flame className="h-5 w-5 text-warning" aria-hidden="true" />
            <h2 className="font-semibold text-text">Risk Feed</h2>
          </div>
          <div className="space-y-3">
            {riskFeed.map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant={item.level === 'High' ? 'danger' : item.level === 'Medium' ? 'warning' : 'success'}>{item.level}</Badge>
                  <span className="text-xs text-muted">{item.time}</span>
                </div>
                <p className="mt-3 text-sm font-medium text-text">{item.title}</p>
                <p className="mt-1 text-xs text-muted">{item.source}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Target className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold text-text">Collection Watchlist</h2>
          </div>
          <div className="space-y-3">
            {watchlist.map((item) => (
              <div key={item.name} className="flex items-center gap-3 rounded-lg border border-border bg-white/5 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{item.name}</p>
                  <p className="text-xs text-muted">{item.chain} / {item.demand}</p>
                </div>
                <span className="font-mono text-sm text-text">{item.score}</span>
              </div>
            ))}
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
            {activity.map(([time, title, detail]) => (
              <div key={`${time}-${title}`} className="flex gap-4 rounded-lg border border-border bg-white/5 p-3">
                <span className="font-mono text-xs text-muted">{time}</span>
                <div>
                  <p className="text-sm font-medium text-text">{title}</p>
                  <p className="mt-1 text-sm text-muted">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Radio className="h-5 w-5 text-success" aria-hidden="true" />
            <h2 className="font-semibold text-text">System Status</h2>
          </div>
          <div className="space-y-3">
            {systemStatuses.map((status) => (
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
