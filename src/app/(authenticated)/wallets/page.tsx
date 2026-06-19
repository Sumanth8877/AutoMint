import { Copy, ExternalLink, Plus, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';

const wallets = [
  { name: 'Primary Mint', address: '0x71c4a1d8e8d7312a9f40c82a', chain: 'Ethereum', balance: '3.42 ETH', health: 'Ready' },
  { name: 'Base Fast Lane', address: '0xb9f0b0823ac99055118e', chain: 'Base', balance: '1.18 ETH', health: 'Ready' },
  { name: 'Guarded Reserve', address: '0x42ac8945ef7d001c78fd', chain: 'Ethereum', balance: '0.62 ETH', health: 'Review' },
];

export default function WalletsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Capital"
        title="Wallets"
        description="Track wallet funding, network coverage, exposure caps, nonce health, and readiness for automated minting."
        actions={
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Wallet
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total Balance" value="5.22 ETH" detail="Available for active strategies" icon={Wallet} tone="success" />
        <MetricCard label="Ready Wallets" value="12" detail="2 need review" icon={ShieldCheck} tone="accent" />
        <MetricCard label="Exposure Used" value="68%" detail="Per-wallet caps enforced" icon={RefreshCw} tone="warning" />
      </div>

      <div className="mt-6 grid gap-4">
        {wallets.map((wallet) => (
          <Card key={wallet.address} tone="interactive" className="p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                <Wallet className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-text">{wallet.name}</h2>
                  <Badge variant={wallet.health === 'Ready' ? 'success' : 'warning'}>{wallet.health}</Badge>
                  <Badge>{wallet.chain}</Badge>
                </div>
                <p className="mt-1 truncate font-mono text-sm text-muted">{wallet.address}</p>
              </div>
              <p className="font-mono text-lg text-text">{wallet.balance}</p>
              <div className="flex gap-1">
                {[Copy, RefreshCw, ExternalLink].map((Icon, index) => (
                  <button key={index} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text" aria-label="Wallet action">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
