'use client';

import { useState } from 'react';
import { Mail, Send } from 'lucide-react';
import EmailClient from './email-client';
import TelegramClient from './telegram-client';

type Tab = 'email' | 'telegram';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'telegram', label: 'Telegram', icon: Send },
];

export default function NotificationsClient() {
  const [tab, setTab] = useState<Tab>('email');

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-text">Notifications</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Configure how AutoMint reaches you for mint events and system alerts.
        </p>
      </div>

      <div role="tablist" aria-label="Notification channels" className="mb-6 flex gap-1 border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`tab-panel-${id}`}
              id={`tab-${id}`}
              onClick={() => setTab(id)}
              className={[
                '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-text'
                  : 'border-transparent text-muted hover:text-text',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`tab-panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'email' ? <EmailClient /> : <TelegramClient />}
      </div>
    </div>
  );
}
