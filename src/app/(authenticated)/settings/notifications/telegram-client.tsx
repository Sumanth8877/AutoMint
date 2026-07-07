'use client';

import { useCallback, useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { AlertCircle, Check, Copy, ExternalLink, Link as LinkIcon, RefreshCw } from 'lucide-react';

type TelegramLinkResponse = {
  enabled: boolean;
  token: string | null;
  linked: boolean;
  account: { username: string | null; chatId: string } | null;
  deepLink: string | null;
  expiresInSeconds: number;
};

export default function TelegramClient() {
  const [data, setData]           = useState<TelegramLinkResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied]       = useState<string | null>(null);    // which item was just copied
  const [fetchError, setFetchError] = useState<string | null>(null);
  // After clicking Generate Token, keep the fresh token visible even if linked
  const [freshToken, setFreshToken] = useState<TelegramLinkResponse | null>(null);

  const fetchTelegramLink = useCallback(async () => {
    try {
      const res    = await fetch('/api/telegram/link-token', { cache: 'no-store' });
      const result = await res.json() as TelegramLinkResponse;
      setData(result);
    } catch {
      setFetchError('Failed to load Telegram settings. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchTelegramLink();
  }, [fetchTelegramLink]);

  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 2500);
  };

  const handleGenerateToken = async () => {
    setGenerating(true);
    setFreshToken(null);
    try {
      const res    = await fetch('/api/telegram/link-token', { cache: 'no-store' });
      const result = await res.json() as TelegramLinkResponse;
      setData(result);
      setFreshToken(result);   // always show token box after explicit generate click
    } catch {
      setFetchError('Failed to generate token. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  // ── Error state ────────────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-danger/30 bg-red-50 dark:bg-red-950/20 p-4 text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="text-sm">{fetchError}</span>
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-xl bg-surface-hover" />
        <div className="h-16 animate-pulse rounded-xl bg-surface-hover" />
      </div>
    );
  }

  // ── Telegram not configured ────────────────────────────────────────────────
  if (!data?.enabled) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-3 text-warning">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Telegram not enabled</p>
            <p className="text-xs text-muted mt-0.5">
              Set <code className="font-mono text-xs">TELEGRAM_ENABLED=true</code> in your environment.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // The token to display — freshToken (just generated) takes priority
  const displayData = freshToken ?? data;

  return (
    <div className="space-y-4">

      {/* ── Link Status ─────────────────────────────────────────────────── */}
      <Card tone="interactive" className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-text">Link Status</h3>
            <p className="mt-1 text-sm text-muted">
              {data.linked
                ? `Linked as ${data.account?.username ? `@${data.account.username}` : `chat ${data.account?.chatId}`}`
                : 'Not linked — generate a token below to connect your Telegram'}
            </p>
          </div>
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            data.linked
              ? 'bg-success/20 text-success'
              : 'bg-warning/20 text-warning'
          }`}>
            {data.linked
              ? <Check className="h-4 w-4" />
              : <AlertCircle className="h-4 w-4" />
            }
          </div>
        </div>
      </Card>

      {/* ── Generate Token card ──────────────────────────────────────────── */}
      <Card tone="interactive" className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="font-semibold text-text">
              {data.linked ? 'Generate New Link Token' : 'Link Telegram Account'}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {data.linked
                ? 'Share this token with another account or re-link a new Telegram user.'
                : 'Generate a one-time token, then send it to the bot to link your account.'}
            </p>
          </div>
          <Button
            onClick={() => void handleGenerateToken()}
            disabled={generating}
            className="shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating…' : 'Generate Token'}
          </Button>
        </div>

        {/* Token display — shown after explicit generate click OR when not yet linked */}
        {(freshToken || !data.linked) && displayData?.token && (
          <div className="space-y-3 border-t border-border pt-4">
            {/* Step instructions */}
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              How to link
            </p>
            <ol className="space-y-2 text-sm text-muted list-decimal list-inside">
              <li>Open the AutoMint Telegram bot</li>
              <li>Send the command below (or click the link)</li>
              <li>Your Telegram will be linked to this account</li>
            </ol>

            {/* /start <token> command */}
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 rounded-lg border border-border bg-surface-hover px-3 py-2 font-mono text-sm text-text break-all">
                /start {displayData.token}
              </code>
              <button
                onClick={() => void copyToClipboard(`/start ${displayData.token}`, 'cmd')}
                title="Copy command"
                className="shrink-0 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-hover hover:bg-surface text-muted hover:text-text transition-colors"
              >
                {copied === 'cmd' ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>

            {/* Deep link */}
            {displayData.deepLink && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <LinkIcon className="h-4 w-4 shrink-0 text-primary" />
                <a
                  href={displayData.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-sm text-primary hover:underline"
                >
                  {displayData.deepLink}
                </a>
                <button
                  onClick={() => void copyToClipboard(displayData.deepLink!, 'link')}
                  title="Copy deep link"
                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded text-primary/70 hover:text-primary transition-colors"
                >
                  {copied === 'link'
                    ? <Check className="h-3.5 w-3.5 text-success" />
                    : <Copy className="h-3.5 w-3.5" />
                  }
                </button>
                <a
                  href={displayData.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded text-primary/70 hover:text-primary transition-colors"
                  title="Open in Telegram"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            <p className="text-xs text-muted/70">
              ⏱ Token expires in {displayData.expiresInSeconds} seconds. Generate a new one if it expires.
            </p>
          </div>
        )}
      </Card>

      {/* ── Available Commands ───────────────────────────────────────────── */}
      {data.linked && (
        <Card tone="interactive" className="p-5">
          <h3 className="font-semibold text-text mb-3">Available Commands</h3>
          <div className="space-y-2 text-sm">
            {[
              ['/mint <url> [qty]',    'Mint from URL instantly'],
              ['/watch <wallet>',      'Track a whale wallet'],
              ['/status',             'View active mints'],
              ['/cancel',             'Cancel latest mint'],
              ['/settings',           'View settings'],
              ['/model',              'Change AI model'],
              ['<url>',               'Paste any URL to mint directly'],
              ['Anything else…',      'AI understands plain English'],
            ].map(([cmd, desc]) => (
              <div key={cmd} className="flex items-center justify-between gap-4">
                <code className="font-mono text-xs text-text">{cmd}</code>
                <span className="text-muted text-right">{desc}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
