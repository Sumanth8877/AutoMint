'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Save } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
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
  { key: 'mintScheduledEnabled', label: 'Mint Scheduled',  description: 'Your mint task has been successfully scheduled.' },
  { key: 'mintSuccessEnabled',   label: 'Mint Success',    description: 'Mint completed successfully.' },
  { key: 'mintFailedEnabled',    label: 'Mint Failed',     description: 'Mint failed, with the failure reason sanitized.' },
  { key: 'systemErrorsEnabled',  label: 'System Errors',  description: 'User-relevant task execution, infrastructure, or wallet execution failures.' },
];

function formatDate(value: string | null) {
  if (!value) return 'Not saved yet';
  return new Date(value).toLocaleString();
}

// ── Neon toggle switch ────────────────────────────────────────────
function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'border-primary/50 bg-primary/20 shadow-[0_0_12px_rgba(79,70,229,0.12)]'
          : 'border-border bg-surface-hover'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full shadow-sm transition-all duration-200 ${
          checked
            ? 'translate-x-6 bg-primary shadow-[0_0_8px_rgba(79,70,229,0.5)]'
            : 'translate-x-1 bg-muted'
        }`}
      />
    </button>
  );
}



export default function EmailNotificationsClient() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EmailPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const { data: settings, isLoading, error: fetchError } = useQuery({
    queryKey: ['email-notifications'],
    queryFn: () => apiRequest<EmailSettingsResponse>('/api/settings/email-notifications'),
  });

  useEffect(() => {
    if (settings) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs fetched preferences into an editable draft form
      setDraft(settings.preferences);
      setSavedAt(settings.preferences.updatedAt);
    }
  }, [settings]);

  useEffect(() => {
    if (fetchError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors React Query fetch failures into local UI state
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load email notification settings.');
    }
  }, [fetchError]);

  const saveMutation = useMutation({
    mutationFn: async (preferences: EmailPreferences) =>
      apiRequest<EmailSettingsResponse>('/api/settings/email-notifications', {
        method: 'POST',
        body: JSON.stringify(preferences),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['email-notifications'], data);
      setDraft(data.preferences);
      setSavedAt(data.preferences.updatedAt);
      setSuccess('Preferences saved successfully.');
      setSaving(false);
      window.setTimeout(() => setSuccess(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to save preferences.');
      setSaving(false);
    },
  });

  function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    saveMutation.mutate(draft);
  }

  function toggle(key: keyof EmailPreferences) {
    if (!draft) return;
    setDraft(prev => prev ? { ...prev, [key]: !prev[key] } : prev);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="skeleton h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold tracking-tight text-text">Email</h3>
          <p className="mt-0.5 text-sm text-muted">Choose which AutoMint emails are delivered to your account address.</p>
        </div>
        <Button variant="neon" onClick={handleSave} loading={saving} glow size="sm">
          <Save className="h-3.5 w-3.5" />
          Save Preferences
        </Button>
      </div>

      {/* Banners */}
      {error && (
        <div className="rounded-xl border border-danger/20 bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-success/20 bg-emerald-50 px-4 py-3 text-sm text-success">{success}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Left — controls */}
        <div className="space-y-4">
          {/* Master toggle */}
          <Card tone="neon" className="p-5">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/15 bg-indigo-50">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold text-text">Email Notifications</p>
                  <p className="text-xs text-muted">Resend is the only email provider.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold uppercase tracking-widest ${draft?.emailEnabled ? 'text-primary' : 'text-muted'}`}>
                  {draft?.emailEnabled ? 'ON' : 'OFF'}
                </span>
                <Toggle
                  checked={draft?.emailEnabled ?? false}
                  onChange={() => toggle('emailEnabled')}
                />
              </div>
            </div>
          </Card>

          {/* Notification types */}
          {draft?.emailEnabled && (
            <div className="space-y-2">
              <p className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Notification Types</p>
              {notificationTypes.map(({ key, label, description }) => {
                const isChecked = !!draft?.[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(key)}
                    className={`group flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-all duration-150 hover:bg-surface-hover ${
                      isChecked
                        ? 'border-primary/20 bg-primary/[0.04]'
                        : 'border-border bg-surface'
                    }`}
                  >
                    <Checkbox checked={isChecked} onChange={() => toggle(key)} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold transition-colors ${isChecked ? 'text-text' : 'text-secondary'}`}>
                        {label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!draft?.emailEnabled && (
            <div className="rounded-xl border border-border bg-surface px-4 py-6 text-center">
              <p className="text-sm text-muted">Enable email notifications to configure individual alert types.</p>
            </div>
          )}
        </div>

        {/* Right — destination panel */}
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Email Destination</p>
          <Card tone="elevated" className="p-5 space-y-4">
            {settings?.destinationEmail && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-1.5">Authenticated Account</p>
                <p className="text-sm font-semibold text-text truncate">{settings.destinationEmail}</p>
              </div>
            )}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Provider</span>
                <span className="text-xs font-semibold text-text">Resend</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">RESEND_API_KEY</span>
                <Badge variant={settings?.providerConfigured ? 'success' : 'danger'} dot>
                  {settings?.providerConfigured ? 'Configured' : 'Missing'}
                </Badge>
              </div>
              {savedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Last Saved</span>
                  <span className="text-xs text-muted">{formatDate(savedAt)}</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
