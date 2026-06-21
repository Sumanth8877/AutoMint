import Link from 'next/link';
import { Bell, ChevronRight, KeyRound, Lock, Radio, Settings, SlidersHorizontal, User, Wallet } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/page-header';

const groups = [
  { title: 'General', icon: User, items: ['Profile'] },
  { title: 'Wallets', icon: Wallet, items: ['Connected Wallets'] },
  { title: 'RPC Providers', icon: Radio, items: ['Provider Settings'] },
  { title: 'Execution', icon: SlidersHorizontal, items: ['Execution Settings'] },
  { title: 'Notifications', icon: Bell, items: ['Email Notifications'] },
  { title: 'Security', icon: Lock, items: ['API Keys'] },
];

const icons = [User, Wallet, Radio, SlidersHorizontal, Bell, KeyRound];

function formatItemCount(count: number) {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function settingHref(groupTitle: string, item: string) {
  if (groupTitle === 'General' && item === 'Profile') return '/settings/profile';
  if (groupTitle === 'Wallets' && item === 'Connected Wallets') return '/settings/connected-wallets';
  if (groupTitle === 'RPC Providers' && item === 'Provider Settings') return '/settings/rpc-providers';
  if (groupTitle === 'Execution' && item === 'Execution Settings') return '/settings/execution';
  if (groupTitle === 'Notifications' && item === 'Email Notifications') return '/settings/email-notifications';
  if (groupTitle === 'Security' && item === 'API Keys') return '/settings/api-keys';
  return null;
}

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Configure preferences, risk controls, notification routing, wallet behavior, and API access."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group, index) => {
          const GroupIcon = group.icon;
          const ItemIcon = icons[index];

          return (
            <Card key={group.title} tone="interactive" className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                    <GroupIcon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h2 className="font-semibold text-text">{group.title}</h2>
                </div>
                <Badge>{formatItemCount(group.items.length)}</Badge>
              </div>
              <div className="divide-y divide-border">
                {group.items.map((item) => {
                  const href = settingHref(group.title, item);
                  const content = (
                    <>
                      <ItemIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                      <span className="text-sm font-medium text-text">{item}</span>
                      {href ? <ChevronRight className="ml-auto h-4 w-4 text-muted" aria-hidden="true" /> : null}
                    </>
                  );

                  return href ? (
                    <Link
                      key={item}
                      href={href}
                      className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-white/5"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={item} className="flex w-full items-center gap-3 px-5 py-4 text-left">
                      {content}
                    </div>
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
