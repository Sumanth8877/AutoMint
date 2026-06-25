'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/page-header';
import { Send, Copy, Check, Link as LinkIcon, AlertCircle } from 'lucide-react';

type TelegramLinkResponse = {
  enabled: boolean;
  token: string | null;
  linked: boolean;
  account: { username: string | null; chatId: string } | null;
  deepLink: string | null;
  expiresInSeconds: number;
};

export default function TelegramSettingsPage() {
  const [data, setData] = useState<TelegramLinkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchTelegramLink();
  }, []);

  const fetchTelegramLink = async () => {
    try {
      const response = await fetch('/api/telegram/link-token');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Failed to fetch Telegram link:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateNewToken = () => {
    fetchTelegramLink();
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          eyebrow="Notifications"
          title="Telegram"
          description="Link your Telegram bot to receive mint notifications and send commands."
        />
        <Card className="p-5">
          <p className="text-sm text-muted">Loading...</p>
        </Card>
      </div>
    );
  }

  if (!data?.enabled) {
    return (
      <div>
        <PageHeader
          eyebrow="Notifications"
          title="Telegram"
          description="Link your Telegram bot to receive mint notifications and send commands."
        />
        <Card className="p-5">
          <div className="flex items-center gap-3 text-warning">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">Telegram is not enabled. Set TELEGRAM_ENABLED=true in your environment.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Notifications"
        title="Telegram"
        description="Link your Telegram bot to receive mint notifications and send commands."
      />

      <div className="space-y-4">
        {/* Link Status */}
        <Card tone="interactive" className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-text mb-1">Link Status</h3>
              <p className="text-sm text-muted">
                {data.linked
                  ? `Linked as ${data.account?.username ? `@${data.account.username}` : data.account?.chatId}`
                  : 'Not linked'}
              </p>
            </div>
            {data.linked && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/20 text-success">
                <Check className="h-4 w-4" />
              </div>
            )}
          </div>
        </Card>

        {/* Link Instructions */}
        {!data.linked && data.token && (
          <Card tone="interactive" className="p-5">
            <h3 className="font-semibold text-text mb-3">Link Your Telegram</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">1. Open your Telegram bot</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">2. Send this command:</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-black/5 px-3 py-2 rounded text-sm font-mono">
                  /start {data.token}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyToClipboard(`/start ${data.token!}`)}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              {data.deepLink && (
                <div className="pt-2">
                  <a
                    href={data.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
                  >
                    <LinkIcon className="h-4 w-4" />
                    Or click to open in Telegram
                  </a>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Generate New Token */}
        <Card tone="interactive" className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-text mb-1">Generate New Link Token</h3>
              <p className="text-sm text-muted">
                {data.token
                  ? `Current token expires in ${data.expiresInSeconds} seconds`
                  : 'Generate a token to link your Telegram account'}
              </p>
            </div>
            <Button onClick={generateNewToken}>
              <Send className="h-4 w-4 mr-2" />
              Generate Token
            </Button>
          </div>
        </Card>

        {/* Available Commands */}
        {data.linked && (
          <Card tone="interactive" className="p-5">
            <h3 className="font-semibold text-text mb-3">Available Commands</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <code className="font-mono">/mint &lt;url&gt;</code>
                <span className="text-muted">Mint from URL</span>
              </div>
              <div className="flex justify-between">
                <code className="font-mono">/schedule &lt;url&gt;</code>
                <span className="text-muted">Schedule a mint</span>
              </div>
              <div className="flex justify-between">
                <code className="font-mono">/watch &lt;wallet&gt;</code>
                <span className="text-muted">Watch a wallet</span>
              </div>
              <div className="flex justify-between">
                <code className="font-mono">/status</code>
                <span className="text-muted">View mint status</span>
              </div>
              <div className="flex justify-between">
                <code className="font-mono">/cancel</code>
                <span className="text-muted">Cancel latest task</span>
              </div>
              <div className="flex justify-between">
                <code className="font-mono">/settings</code>
                <span className="text-muted">View settings</span>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
