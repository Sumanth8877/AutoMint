'use client';

import { useState } from 'react';
import { Bell, ChevronRight, KeyRound, Lock, Palette, Radio, Settings, ShieldCheck, SlidersHorizontal, User, Wallet } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';

const groups = [
  { title: 'General', icon: User, items: ['Profile', 'Appearance', 'Language'] },
  { title: 'Wallets', icon: Wallet, items: ['Connected Wallets', 'Default Wallet', 'Network Preferences'] },
  { title: 'RPC Providers', icon: Radio, items: ['Provider Settings', 'Gas Optimization', 'Timeout Settings'] },
  { title: 'Execution', icon: SlidersHorizontal, items: ['Mint Defaults', 'Retry Logic', 'Risk Gates'] },
  { title: 'Notifications', icon: Bell, items: ['Alert Preferences', 'Email Notifications', 'Push Notifications'] },
  { title: 'Security', icon: Lock, items: ['Two-Factor Auth', 'Session Management', 'API Keys'] },
];

const icons = [Palette, Wallet, Radio, ShieldCheck, Bell, KeyRound];

export default function SettingsPage() {
  const [activeSetting, setActiveSetting] = useState<string | null>(null);

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
                <Badge>{group.items.length} items</Badge>
              </div>
              <div className="divide-y divide-border">
                {group.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setActiveSetting(`${group.title}: ${item}`)}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-white/5"
                  >
                    <ItemIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                    <span className="text-sm font-medium text-text">{item}</span>
                    <ChevronRight className="ml-auto h-4 w-4 text-muted" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 p-5">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-accent" aria-hidden="true" />
          <p className="text-sm text-muted">Security-sensitive settings should be backed by server-side authorization checks, not navigation visibility alone.</p>
        </div>
      </Card>

      <Modal open={Boolean(activeSetting)} title={activeSetting ?? 'Settings'} onClose={() => setActiveSetting(null)}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">
            This settings area is not backed by a persistence endpoint yet. The action now opens intentionally instead of acting like a silent mutation.
          </p>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => setActiveSetting(null)}>Close</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
