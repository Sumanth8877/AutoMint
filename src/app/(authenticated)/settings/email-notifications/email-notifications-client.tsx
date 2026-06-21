'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, Save } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { apiRequest } from '@/lib/api/client';

type EmailPreferences = {
  emailEnabled: boolean;
  mintScheduledEnabled: boolean;
  mintSuccessEnabled: boolean;
  mintFailedEnabled: boolean;
  systemErrorsEnabled: boolean;
  updatedAt: string;
};

type EmailSettingsResponse = {
  preferences: EmailPreferences;
  destinationEmail: string;
  provider: 'Resend';
  providerConfigured: boolean;
};

const notificationTypes: Array<{ key: keyof EmailPreferences; label: string; description: string }> = [
  {
    key: 'mintScheduledEnabled',
    label: 'Mint Scheduled',
    description: 'Your mint task has been successfully scheduled.',
  },
  {
    key: 'mintSuccessEnabled',
    label: 'Mint Success',
    description: 'Mint completed successfully.',
  },
  {
    key: 'mintFailedEnabled',
    label: 'Mint Failed',
    description: 'Mint failed, with the failure reason sanitized.',
  },
  {
    key: 'systemErrorsEnabled',
    label: 'System Errors',
    description: 'User-relevant task execution, infrastructure, or wallet execution failures.',
  },
];

function formatDate(value: string | null) {
  if (!value) return 'Not saved yet';
  return new Date(value).toLocaleString();
}

export default function EmailNotificationsClient() {
  const [settings, setSettings] = useState<EmailSettingsResponse | null>(null);
  const [draft, setDraft] = useState<EmailPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function saveSettings() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<EmailSettingsResponse>('/api/settings/email-notifications', {
        method: 'PATCH',
        cache: 'no-store',
        body: draft,
      });
      setSettings(response);
      setDraft(response.preferences);
      setSavedAt(new Date().toISOString());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save email notification settings.');
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(key: keyof EmailPreferences, value: boolean) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  useEffect(() => {
    let active = true;

    apiRequest<EmailSettingsResponse>('/api/settings/email-notifications', {
      cache: 'no-store',
    })
      .then((response) => {
        if (!active) return;
        setSettings(response);
        setDraft(response.preferences);
        setError(null);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load email notification settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/settings" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
          <h1 className="mt-3 text-2xl font-semibold text-text sm:text-3xl">Email Notifications</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Control which AutoMint emails are sent to your authenticated account email.
          </p>
        </div>
        <Button type="button" onClick={saveSettings} loading={saving} disabled={loading || !draft}>
          <Save className="h-4 w-4" aria-hidden="true" />
          Save Preferences
        </Button>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                <Mail className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-text">Email Notifications</h2>
                <p className="mt-1 text-sm text-muted">Resend is the only email provider.</p>
              </div>
            </div>
            <Badge variant={draft?.emailEnabled ? 'success' : 'default'}>{draft?.emailEnabled ? 'ON' : 'OFF'}</Badge>
          </div>

          {loading || !draft ? (
            <div className="py-10 text-sm text-muted">Loading email preferences...</div>
          ) : (
            <div className="divide-y divide-border">
              <label className="flex items-start gap-3 py-5">
                <input
                  type="checkbox"
                  checked={draft.emailEnabled}
                  onChange={(event) => updateDraft('emailEnabled', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="block text-sm font-medium text-text">Enable Email Notifications</span>
                  <span className="mt-1 block text-sm text-muted">When disabled, AutoMint will not send email notifications.</span>
                </span>
              </label>

              <div className="py-5">
                <h3 className="text-sm font-semibold text-text">Notification Types</h3>
                <div className="mt-3 grid gap-3">
                  {notificationTypes.map((item) => (
                    <label key={item.key} className="flex items-start gap-3 rounded-lg border border-border bg-white/[0.03] p-4">
                      <input
                        type="checkbox"
                        checked={Boolean(draft[item.key])}
                        onChange={(event) => updateDraft(item.key, event.target.checked)}
                        className="mt-1 h-4 w-4 accent-primary"
                      />
                      <span>
                        <span className="block text-sm font-medium text-text">{item.label}</span>
                        <span className="mt-1 block text-sm text-muted">{item.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-text">Email Destination</h2>
          <div className="mt-4 rounded-lg border border-border bg-white/[0.03] p-4">
            <p className="text-xs uppercase text-muted">Authenticated Account</p>
            <p className="mt-2 break-all text-sm font-medium text-text">
              {settings?.destinationEmail ? (
                <a href={`mailto:${settings.destinationEmail}`} className="hover:text-accent">
                  {settings.destinationEmail}
                </a>
              ) : (
                'No email available'
              )}
            </p>
          </div>

          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Provider</span>
              <span className="font-medium text-text">{settings?.provider ?? 'Resend'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">RESEND_API_KEY</span>
              <Badge variant={settings?.providerConfigured ? 'success' : 'danger'}>
                {settings?.providerConfigured ? 'Configured' : 'Missing'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Last Saved</span>
              <span className="text-right text-text">{formatDate(savedAt ?? draft?.updatedAt ?? null)}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
