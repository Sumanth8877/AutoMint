'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, EyeOff, Key, Save, Trash2, XCircle, Loader2 } from 'lucide-react';
import Card from '@/components/ui/Card';
import { apiRequest } from '@/lib/api/client';

interface AIKeysStatus {
  gemini: { configured: boolean; maskedKey: string | null; updatedAt: string | null };
  nara: { configured: boolean; maskedKey: string | null; updatedAt: string | null };
  geminiEnvConfigured: boolean;
  naraEnvConfigured: boolean;
}

function KeyInput({
  provider,
  label,
  placeholder,
  status,
  envConfigured,
  onSave,
  onDelete,
  saving,
}: {
  provider: 'gemini' | 'nara';
  label: string;
  placeholder: string;
  status: { configured: boolean; maskedKey: string | null; updatedAt: string | null };
  envConfigured: boolean;
  onSave: (provider: string, key: string) => void;
  onDelete: (provider: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);

  const handleSave = () => {
    if (value.trim()) {
      onSave(provider, value.trim());
      setEditing(false);
      setValue('');
      setShowValue(false);
    }
  };

  const handleDelete = () => {
    onDelete(provider);
    setEditing(false);
    setValue('');
  };

  const source = status.configured ? 'Database' : envConfigured ? 'Environment' : null;

  return (
    <div className="rounded-lg border border-border bg-surface-hover/30 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <Key className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-semibold text-text">{label}</p>
            <p className="text-xs text-muted">
              {source === 'Database' && (
                <span className="text-emerald-400">Stored in database (encrypted)</span>
              )}
              {source === 'Environment' && (
                <span className="text-blue-400">Using environment variable</span>
              )}
              {!source && (
                <span className="text-amber-400">Not configured</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(status.configured || envConfigured) ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
              <XCircle className="h-3.5 w-3.5" />
              Missing
            </span>
          )}
        </div>
      </div>

      {/* Current masked key */}
      {status.configured && status.maskedKey && !editing && (
        <div className="flex items-center gap-2 mb-3">
          <code className="flex-1 rounded bg-surface-hover px-3 py-2 font-mono text-xs text-muted tracking-wider">
            {status.maskedKey}
          </code>
          {status.updatedAt && (
            <span className="text-xs text-muted shrink-0">
              Updated {new Date(status.updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      {/* Edit mode */}
      {editing ? (
        <div className="space-y-2">
          <div className="relative">
            <input
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 pr-10 font-mono text-sm text-text placeholder:text-muted/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowValue(!showValue)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!value.trim() || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save Key
            </button>
            <button
              onClick={() => { setEditing(false); setValue(''); setShowValue(false); }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-text hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-hover transition-colors"
          >
            <Key className="h-3 w-3" />
            {status.configured ? 'Change Key' : 'Add Key'}
          </button>
          {status.configured && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-danger hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Remove DB Key
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AIKeysManager() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<AIKeysStatus>({
    queryKey: ['ai-keys'],
    queryFn: () => apiRequest<AIKeysStatus>('/api/settings/ai-keys'),
  });

  const saveMutation = useMutation({
    mutationFn: ({ provider, key }: { provider: string; key: string }) =>
      apiRequest('/api/settings/ai-keys', {
        method: 'POST',
        body: { provider, key },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-keys'] });
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (provider: string) =>
      apiRequest('/api/settings/ai-keys', {
        method: 'POST',
        body: { provider, key: null },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-keys'] });
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
    },
  });

  if (isLoading || !status) {
    return (
      <Card className="p-5">
        <div className="space-y-3">
          <div className="h-6 w-48 rounded bg-surface-hover animate-pulse" />
          <div className="h-24 rounded-lg bg-surface-hover animate-pulse" />
          <div className="h-24 rounded-lg bg-surface-hover animate-pulse" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text">AI Provider Keys</h3>
        <p className="mt-0.5 text-xs text-muted">
          Manage your AI provider API keys directly from here. Keys stored in the database
          take priority over environment variables. Encrypted with AES-256-GCM.
        </p>
      </div>

      <div className="space-y-3">
        <KeyInput
          provider="gemini"
          label="Gemini API Key (Google AI)"
          placeholder="AIzaSy..."
          status={status.gemini}
          envConfigured={status.geminiEnvConfigured}
          onSave={(p, k) => saveMutation.mutate({ provider: p, key: k })}
          onDelete={p => deleteMutation.mutate(p)}
          saving={saveMutation.isPending || deleteMutation.isPending}
        />
        <KeyInput
          provider="nara"
          label="Nara API Key (Mistral Router)"
          placeholder="nara_..."
          status={status.nara}
          envConfigured={status.naraEnvConfigured}
          onSave={(p, k) => saveMutation.mutate({ provider: p, key: k })}
          onDelete={p => deleteMutation.mutate(p)}
          saving={saveMutation.isPending || deleteMutation.isPending}
        />
      </div>

      <p className="mt-4 text-xs text-muted/60">
        💡 Database keys override environment variables. Remove a DB key to fall back to the env var.
      </p>
    </Card>
  );
}
