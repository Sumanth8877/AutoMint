"use client";

import { useState } from "react";
import { ArrowLeft, Check, Copy, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/page-header";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mask a key value for display while hidden.
 * Shows the first 4 chars + bullets + last 4 chars (or all bullets if too short).
 */
function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "•".repeat(Math.max(8, key.length));
  return `${key.slice(0, 4)}${"•".repeat(24)}${key.slice(-4)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ApiKeysClient({ apiKey }: { apiKey: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fall back to no-op.
      // The user can still reveal and select-to-copy.
    }
  }

  const hasKey = apiKey.length > 0;
  const displayed = revealed ? apiKey : maskKey(apiKey);

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Link>
      </div>

      <PageHeader
        title="API Key"
        description="This key authenticates programmatic access to AutoMint. Configure it via the AUTOMINT_API_KEY environment variable in Vercel."
      />

      <Card className="p-6">
        {hasKey ? (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted">
              AUTOMINT_API_KEY
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 p-3">
              <code
                className="flex-1 break-all font-mono text-sm text-text"
                aria-label={revealed ? "API key (visible)" : "API key (masked)"}
              >
                {displayed}
              </code>

              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                className="rounded-md p-2 text-muted transition hover:bg-white/5 hover:text-text"
                aria-label={revealed ? "Hide API key" : "Show API key"}
                title={revealed ? "Hide" : "Show"}
              >
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="rounded-md p-2 text-muted transition hover:bg-white/5 hover:text-text"
                aria-label="Copy API key"
                title={copied ? "Copied" : "Copy"}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>

            <p className="text-xs text-muted">
              Use this key as a Bearer token:{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono">
                Authorization: Bearer {revealed ? apiKey : "<key>"}
              </code>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm font-medium text-text">No API key configured</div>
            <p className="text-sm text-muted">
              Set the{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono">AUTOMINT_API_KEY</code>{" "}
              environment variable in your Vercel project to enable programmatic access.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
