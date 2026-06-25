import Link from 'next/link';
import { Bell, ChevronRight, KeyRound, Lock, Radio, Settings, SlidersHorizontal, User, Wrench } from 'lucide-react';
import Card from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/page-header';

// Cache this static page for 4 hours
export const revalidate = 14400;

const groups: { title: string; icon: React.ElementType; items: { label: string; href: string; icon: React.ElementType; description: string }[] }[] = [
  {
    title: 'General',
    icon: User,
    items: [{ label: 'Profile', href: '/settings/profile', icon: User, description: 'Name, email and account details' }],
  },
  {
    title: 'RPC Providers',
    icon: Radio,
    items: [{ label: 'Provider Settings', href: '/settings/rpc-providers', icon: Radio, description: 'Alchemy, QuickNode and failover' }],
  },
  {
    title: 'Execution',
    icon: SlidersHorizontal,
    items: [{ label: 'Execution Settings', href: '/settings/execution', icon: SlidersHorizontal, description: 'Gas strategy, retries, risk threshold' }],
  },
  {
    title: 'Notifications',
    icon: Bell,
    items: [{ label: 'Email Notifications', href: '/settings/email-notifications', icon: Bell, description: 'Mint alerts and system errors' }],
  },
  {
    title: 'Security',
    icon: Lock,
    items: [{ label: 'API Keys', href: '/settings/api-keys', icon: KeyRound, description: 'Manage personal API tokens' }],
  },
  {
    title: 'System',
    icon: Wrench,
    items: [{ label: 'System Maintenance', href: '/settings/system', icon: Wrench, description: 'Dependency audit and package updates' }],
  },
];

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Configure preferences, risk controls, notification routing, wallet behavior, and API access."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const GroupIcon = group.icon;

          return (
            <Card key={group.title} tone="interactive" className="overflow-hidden">
              <div className="flex items-center border-b border-border p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                    <GroupIcon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h2 className="font-semibold text-text">{group.title}</h2>
                </div>
              </div>
              <div className="divide-y divide-border">
                {group.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-white/5"
                    >
                      <ItemIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-text">{item.label}</span>
                        <p className="text-xs text-muted truncate">{item.description}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 p-5">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-accent" aria-hidden="true" />
          <p className="text-sm text-muted">Security-sensitive settings are verified from environment configuration on the server.</p>
        </div>
      </Card>
    </div>
  );
}
