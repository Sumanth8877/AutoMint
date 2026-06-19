import { CheckCircle2, Clock3, History, Play, ShieldAlert, XCircle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/page-header';

const days = [
  {
    date: 'Today',
    events: [
      ['08:42', 'Strategy updated', 'Raised priority fee for Eclipse Foundry', 'success'],
      ['08:21', 'Risk blocked', 'Night Market requires manual approval', 'danger'],
      ['08:12', 'Collection analyzed', 'Tensorian Seeds scored 91', 'info'],
    ],
  },
  {
    date: 'Yesterday',
    events: [
      ['18:03', 'Mint completed', 'Base Arcade minted 3 tokens', 'success'],
      ['15:44', 'Wallet refreshed', 'Primary Mint balance updated', 'info'],
    ],
  },
];

function IconForStatus({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />;
  if (status === 'danger') return <XCircle className="h-4 w-4 text-danger" aria-hidden="true" />;
  if (status === 'running') return <Play className="h-4 w-4 text-accent" aria-hidden="true" />;
  return <Clock3 className="h-4 w-4 text-muted" aria-hidden="true" />;
}

export default function HistoryPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Audit Trail"
        title="History"
        description="Review analysis events, risk interventions, wallet updates, and mint execution history."
      />

      <Card tone="elevated" className="p-5">
        <div className="mb-5 flex items-center gap-3">
          <History className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="font-semibold text-text">Activity Timeline</h2>
        </div>
        <div className="space-y-8">
          {days.map((day) => (
            <section key={day.date}>
              <h3 className="mb-3 text-xs font-semibold uppercase text-muted">{day.date}</h3>
              <div className="space-y-3">
                {day.events.map(([time, title, detail, status]) => (
                  <div key={`${time}-${title}`} className="flex gap-4 rounded-lg border border-border bg-white/5 p-4">
                    <div className="mt-0.5"><IconForStatus status={status} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-text">{title}</p>
                        <Badge variant={status === 'success' ? 'success' : status === 'danger' ? 'danger' : 'info'}>{status}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted">{detail}</p>
                    </div>
                    <span className="font-mono text-xs text-muted">{time}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-warning" aria-hidden="true" />
          <p className="text-sm text-muted">Manual approvals, risk blocks, and execution overrides are retained here for operator review.</p>
        </div>
      </Card>
    </div>
  );
}
