import { FolderKanban, Plus, Radar, ShieldAlert, Sparkles, TrendingUp } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';

const collections = [
  { name: 'Tensorian Seeds', chain: 'Solana', status: 'Watching', score: 91, risk: 'Low' },
  { name: 'Eclipse Foundry', chain: 'Base', status: 'Strategy ready', score: 84, risk: 'Medium' },
  { name: 'Night Market Pass', chain: 'Ethereum', status: 'Blocked', score: 69, risk: 'High' },
  { name: 'Aster Garden', chain: 'Solana', status: 'Watching', score: 78, risk: 'Low' },
];

export default function CollectionsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Research"
        title="Collections"
        description="Manage collection watchlists, launchpad metadata, demand signals, and risk posture."
        actions={
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Collection
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Tracked" value="128" detail="Across 9 launchpads" icon={FolderKanban} tone="primary" />
        <MetricCard label="High Demand" value="24" detail="Above confidence threshold" icon={TrendingUp} tone="accent" />
        <MetricCard label="Blocked" value="7" detail="Risk gate active" icon={ShieldAlert} tone="danger" />
      </div>

      {collections.length > 0 ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {collections.map((collection) => (
            <Card key={collection.name} tone="interactive" className="p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                </div>
                <Badge variant={collection.risk === 'Low' ? 'success' : collection.risk === 'Medium' ? 'warning' : 'danger'}>
                  {collection.risk}
                </Badge>
              </div>
              <h2 className="font-semibold text-text">{collection.name}</h2>
              <p className="mt-1 text-sm text-muted">{collection.chain}</p>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-sm text-muted">{collection.status}</span>
                <span className="font-mono text-xl text-text">{collection.score}</span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={Radar}
            title="No collections tracked"
            description="Paste a launchpad URL or import a watchlist to start scoring collection risk, demand, and execution readiness."
            action={
              <Button>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Collection
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
