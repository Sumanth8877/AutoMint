import { CalendarClock, MoreHorizontal, Play, Plus, RotateCcw, ShieldCheck, Trash2, Zap } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';

const tasks = [
  { collection: 'Eclipse Foundry', phase: 'Public', status: 'Executing', wallet: '0x71...c82a', fee: 'p82', eta: '02:14', risk: 'Low' },
  { collection: 'Tensorian Seeds', phase: 'Allowlist', status: 'Queued', wallet: '0xb9...118e', fee: 'p75', eta: '09:32', risk: 'Medium' },
  { collection: 'Night Market Pass', phase: 'Monitor', status: 'Blocked', wallet: '0x42...78fd', fee: 'Hold', eta: '31:00', risk: 'High' },
  { collection: 'Base Arcade', phase: 'Public', status: 'Ready', wallet: '0x6d...a0f4', fee: 'p68', eta: '1h 12m', risk: 'Low' },
];

export default function MintsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Execution"
        title="Mints"
        description="Plan, monitor, pause, and retry mint execution tasks with clear risk state and wallet assignment."
        actions={
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Mint
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Executing" value="4" detail="Across 3 chains" icon={Zap} tone="primary" />
        <MetricCard label="Queued" value="8" detail="Next hour" icon={CalendarClock} tone="accent" />
        <MetricCard label="Ready" value="19" detail="Strategy approved" icon={ShieldCheck} tone="success" />
        <MetricCard label="Retries" value="2" detail="Awaiting operator" icon={RotateCcw} tone="warning" />
      </div>

      <Card className="mt-6 overflow-hidden" tone="elevated">
        <div className="grid grid-cols-12 gap-4 border-b border-border px-5 py-3 text-xs font-medium uppercase text-muted">
          <span className="col-span-5">Collection</span>
          <span className="col-span-2 hidden md:block">Status</span>
          <span className="col-span-2 hidden lg:block">Wallet</span>
          <span className="col-span-2 hidden sm:block">ETA</span>
          <span className="col-span-7 text-right sm:col-span-1">Actions</span>
        </div>
        <div className="divide-y divide-border">
          {tasks.map((task) => (
            <div key={task.collection} className="grid grid-cols-12 gap-4 px-5 py-4">
              <div className="col-span-5 min-w-0">
                <p className="truncate font-medium text-text">{task.collection}</p>
                <p className="mt-1 text-xs text-muted">{task.phase} phase / fee {task.fee}</p>
              </div>
              <div className="col-span-2 hidden md:block">
                <Badge variant={task.risk === 'Low' ? 'success' : task.risk === 'Medium' ? 'warning' : 'danger'}>{task.status}</Badge>
              </div>
              <p className="col-span-2 hidden font-mono text-sm text-muted lg:block">{task.wallet}</p>
              <p className="col-span-2 hidden font-mono text-sm text-text sm:block">{task.eta}</p>
              <div className="col-span-7 flex justify-end gap-1 sm:col-span-1">
                <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text" aria-label={`Start ${task.collection}`}>
                  <Play className="h-4 w-4" aria-hidden="true" />
                </button>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-danger" aria-label={`Delete ${task.collection}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-text">Execution Queue</h2>
            <p className="mt-1 text-sm text-muted">No unassigned tasks. New analyses can be staged directly from Analyzer.</p>
          </div>
          <Button variant="secondary">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            Queue Settings
          </Button>
        </div>
      </Card>
    </div>
  );
}
