import { Activity, BarChart3, Gauge, Radio, RefreshCcw, TrendingUp, Wifi } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';

const logs = [
  ['08:32:05', 'Broadcasted', 'Eclipse Foundry to 0x71...c82a', '340ms'],
  ['08:32:01', 'Requirements fetched', 'Mint price 0.08 ETH', '890ms'],
  ['08:31:58', 'Intent resolved', 'Contract 0xBC4C... selector valid', '1.2s'],
  ['08:31:45', 'Execution prepared', 'Calldata, gas, and risk gates staged', '230ms'],
];

export default function AnalyticsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Telemetry"
        title="Analytics"
        description="Execution telemetry, system performance, provider health, and conversion signals across mint operations."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Success Rate" value="93.8%" detail="1,239 / 1,321 mints" icon={TrendingUp} tone="success" />
        <MetricCard label="Avg Execution" value="1.24s" detail="End to end" icon={Gauge} tone="accent" />
        <MetricCard label="Avg Broadcast" value="320ms" detail="RPC submit" icon={Radio} tone="primary" />
        <MetricCard label="Failovers" value="3" detail="Last 24 hours" icon={RefreshCcw} tone="warning" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card tone="elevated" className="p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-accent" aria-hidden="true" />
              <h2 className="font-semibold text-text">Performance Health</h2>
            </div>
            <Badge variant="success">Fast</Badge>
          </div>
          <div className="space-y-5">
            {[
              ['Execution Speed', 82, '1,240ms'],
              ['Broadcast Speed', 91, '320ms'],
              ['Success Rate', 94, '93.8%'],
              ['Analyzer Confidence', 86, '86.4%'],
            ].map(([label, width, value]) => (
              <div key={label as string}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted">{label}</span>
                  <span className="font-mono text-text">{value}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <Wifi className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold text-text">RPC Provider</h2>
          </div>
          <div className="space-y-4">
            {[
              ['Provider', 'Alchemy'],
              ['Latency', '42ms'],
              ['Status', 'Healthy'],
              ['Failovers', '3'],
              ['Regions', 'iad1, sfo1'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted">{label}</span>
                <span className="text-sm font-medium text-text">{value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="font-semibold text-text">Recent Execution Log</h2>
          </div>
        </div>
        <div className="divide-y divide-border">
          {logs.map(([time, action, detail, ms]) => (
            <div key={`${time}-${action}`} className="grid gap-3 p-4 md:grid-cols-[90px_180px_1fr_80px] md:items-center">
              <span className="font-mono text-xs text-muted">{time}</span>
              <span className="text-sm font-medium text-text">{action}</span>
              <span className="text-sm text-muted">{detail}</span>
              <span className="font-mono text-sm text-text">{ms}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
