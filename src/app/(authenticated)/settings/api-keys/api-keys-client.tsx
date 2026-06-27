"use client";

import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Key,
  MoreVertical,
  Pencil,
  Plus,
  Shield,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { apiRequest } from "@/lib/api/client";

// ─── Types ──────────────────────────────────────────────────
type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateApiKeyResult = {
  plainTextKey: string;
  key: ApiKeyRecord;
};

const SCOPE_OPTIONS = [
  { value: "*", label: "Full access", description: "All API operations" },
  { value: "mints:read", label: "Mints (read)", description: "View mint tasks" },
  { value: "mints:write", label: "Mints (write)", description: "Create and manage mints" },
  { value: "history:read", label: "History", description: "View mint history" },
  { value: "analyzer:read", label: "Analyzer", description: "Run collection analysis" },
  { value: "wallets:read", label: "Wallets (read)", description: "View wallet list" },
  { value: "collections:read", label: "Collections (read)", description: "View collections" },
] as const;

const EXPIRY_OPTIONS = [
  { value: null, label: "Never" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "1 year" },
] as const;

// ─── Helpers ────────────────────────────────────────────────
function relativeTime(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return date.toLocaleDateString();
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function keyStatus(key: ApiKeyRecord): { label: string; variant: "success" | "danger" | "warning" | "default" } {
  if (key.revokedAt) return { label: "Revoked", variant: "danger" };
  if (isExpired(key.expiresAt)) return { label: "Expired", variant: "warning" };
  return { label: "Active", variant: "success" };
}

// ─── Create Key Modal ───────────────────────────────────────
function CreateKeyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: CreateApiKeyResult) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["*"]);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<CreateApiKeyResult>("/api/api-keys", {
        method: "POST",
        body: { name, scopes, expiresInDays },
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      onCreated(result);
      setName("");
      setScopes(["*"]);
      setExpiresInDays(null);
    },
  });

  function toggleScope(scope: string) {
    if (scope === "*") {
      setScopes(["*"]);
      return;
    }
    setScopes((prev) => {
      const without = prev.filter((s) => s !== "*" && s !== scope);
      if (prev.includes(scope)) {
        return without.length === 0 ? ["*"] : without;
      }
      return [...without, scope];
    });
  }

  return (
    <Modal open={open} title="Create API Key" onClose={onClose}>
      <div className="space-y-5">
        {/* Name */}
        <Input
          label="Key name"
          placeholder="e.g. Gumloop Agent, CI Pipeline"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          autoFocus
        />

        {/* Scopes */}
        <div>
          <label className="mb-2 block text-sm font-medium text-muted">Permissions</label>
          <div className="grid gap-2">
            {SCOPE_OPTIONS.map((opt) => {
              const active = scopes.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleScope(opt.value)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all ${
                    active
                      ? "border-primary/40 bg-primary/10 text-text"
                      : "border-border bg-white/[0.02] text-muted hover:border-white/12 hover:bg-white/5"
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      active ? "border-primary bg-primary text-white" : "border-border bg-transparent"
                    }`}
                  >
                    {active && <Check className="h-3 w-3" />}
                  </div>
                  <div>
                    <p className="font-medium">{opt.label}</p>
                    <p className="text-xs text-muted">{opt.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Expiration */}
        <div>
          <label className="mb-2 block text-sm font-medium text-muted">Expiration</label>
          <div className="flex flex-wrap gap-2">
            {EXPIRY_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setExpiresInDays(opt.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  expiresInDays === opt.value
                    ? "border-primary/40 bg-primary/10 text-text"
                    : "border-border text-muted hover:border-white/12 hover:text-text"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name.trim()}
            loading={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Key className="h-3.5 w-3.5" />
            Generate Key
          </Button>
        </div>

        {createMutation.isError && (
          <p className="text-sm text-danger">
            {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create key"}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── Reveal Key Modal ───────────────────────────────────────
function RevealKeyModal({
  open,
  plainTextKey,
  keyName,
  onClose,
}: {
  open: boolean;
  plainTextKey: string;
  keyName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(plainTextKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={open} title="API Key Created" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-warning/20 bg-warning/5 p-3">
          <p className="text-sm text-warning">
            <strong>Copy your key now.</strong> You won&apos;t be able to see it again.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">{keyName}</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-background/70 px-3 py-2.5 font-mono text-xs text-text">
              {revealed ? plainTextKey : `${plainTextKey.slice(0, 11)}${"•".repeat(32)}`}
            </code>
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:bg-white/5 hover:text-text"
              title={revealed ? "Hide" : "Reveal"}
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-medium transition-all ${
                copied
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-border text-muted hover:bg-white/5 hover:text-text"
              }`}
              title="Copy to clipboard"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Key Row Actions ────────────────────────────────────────
function KeyActions({
  apiKey,
  onRevoke,
  onDelete,
  onRename,
}: {
  apiKey: ApiKeyRecord;
  onRevoke: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(apiKey.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status = keyStatus(apiKey);
  const isActive = status.label === "Active";

  if (renaming) {
    return (
      <div className="flex items-center gap-2">
        <input
          className="h-8 rounded-md border border-border bg-background/70 px-2 text-sm text-text focus:border-primary focus:outline-none"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              onRename(apiKey.id, newName);
              setRenaming(false);
            }
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          maxLength={64}
        />
        <button
          type="button"
          onClick={() => {
            if (newName.trim()) onRename(apiKey.id, newName);
            setRenaming(false);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md text-success hover:bg-success/10"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setRenaming(false)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-white/5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (confirmDelete) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-danger">Delete permanently?</span>
        <Button variant="danger" size="sm" onClick={() => { onDelete(apiKey.id); setConfirmDelete(false); }}>
          Yes, delete
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {menuOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-elevated shadow-xl">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-text hover:bg-white/5"
              onClick={() => { setRenaming(true); setMenuOpen(false); }}
            >
              <Pencil className="h-3.5 w-3.5 text-muted" />
              Rename
            </button>

            {isActive && (
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-warning hover:bg-white/5"
                onClick={() => { onRevoke(apiKey.id); setMenuOpen(false); }}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Revoke
              </button>
            )}

            <button
              type="button"
              className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2.5 text-left text-sm text-danger hover:bg-white/5"
              onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────
export default function ApiKeysClient() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealState, setRevealState] = useState<{ key: string; name: string } | null>(null);

  // Fetch keys
  const { data, isLoading, error } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiRequest<{ keys: ApiKeyRecord[] }>("/api/api-keys"),
  });

  const keys = data?.keys ?? [];

  // Mutations
  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("/api/api-keys", { method: "PATCH", body: { id, action: "revoke" } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("/api/api-keys", { method: "DELETE", body: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest("/api/api-keys", { method: "PATCH", body: { id, action: "rename", name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const activeKeys = keys.filter((k) => !k.revokedAt && !isExpired(k.expiresAt));
  const inactiveKeys = keys.filter((k) => k.revokedAt || isExpired(k.expiresAt));

  return (
    <div>
      <PageHeader
        eyebrow="Security"
        title="API Keys"
        description="Create and manage API keys for programmatic access. Keys authenticate as your account via Bearer tokens."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Create Key
          </Button>
        }
      />

      {/* Back link */}
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Settings
      </Link>

      {/* Loading state */}
      {isLoading && (
        <Card className="p-8">
          <div className="flex items-center justify-center gap-3 text-muted">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
            <span className="text-sm">Loading API keys…</span>
          </div>
        </Card>
      )}

      {/* Error state */}
      {error && (
        <Card className="border-danger/20 bg-danger/5 p-4">
          <p className="text-sm text-danger">
            {error instanceof Error ? error.message : "Failed to load API keys"}
          </p>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !error && keys.length === 0 && (
        <Card className="p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-white/[0.02]">
            <Key className="h-6 w-6 text-muted" />
          </div>
          <h3 className="mb-1 font-semibold text-text">No API keys</h3>
          <p className="mb-5 text-sm text-muted">
            Create an API key to authenticate programmatic requests to your AutoMint instance.
          </p>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Create your first key
          </Button>
        </Card>
      )}

      {/* Active Keys */}
      {activeKeys.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
            <Shield className="h-4 w-4 text-success" />
            Active Keys
            <Badge variant="success">{activeKeys.length}</Badge>
          </h2>
          <div className="space-y-2">
            {activeKeys.map((k) => (
              <KeyRow
                key={k.id}
                apiKey={k}
                onRevoke={(id) => revokeMutation.mutate(id)}
                onDelete={(id) => deleteMutation.mutate(id)}
                onRename={(id, name) => renameMutation.mutate({ id, name })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inactive Keys */}
      {inactiveKeys.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
            <ShieldOff className="h-4 w-4" />
            Revoked / Expired
            <Badge>{inactiveKeys.length}</Badge>
          </h2>
          <div className="space-y-2 opacity-60">
            {inactiveKeys.map((k) => (
              <KeyRow
                key={k.id}
                apiKey={k}
                onRevoke={(id) => revokeMutation.mutate(id)}
                onDelete={(id) => deleteMutation.mutate(id)}
                onRename={(id, name) => renameMutation.mutate({ id, name })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Usage guide */}
      {keys.length > 0 && (
        <Card className="mt-8 p-5">
          <h3 className="mb-3 text-sm font-semibold text-text">Quick Start</h3>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">cURL</p>
              <code className="block overflow-x-auto rounded-lg border border-border bg-background/70 px-3 py-2 font-mono text-xs text-muted">
                curl -H &quot;Authorization: Bearer am_YOUR_KEY&quot; {typeof window !== "undefined" ? window.location.origin : "https://your-app.vercel.app"}/api/mints
              </code>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">JavaScript / Node.js</p>
              <code className="block overflow-x-auto whitespace-pre rounded-lg border border-border bg-background/70 px-3 py-2 font-mono text-xs text-muted">
{`fetch("/api/mints", {
  headers: { Authorization: "Bearer am_YOUR_KEY" }
})`}
              </code>
            </div>
          </div>
        </Card>
      )}

      {/* Modals */}
      <CreateKeyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          setCreateOpen(false);
          setRevealState({ key: result.plainTextKey, name: result.key.name });
        }}
      />

      {revealState && (
        <RevealKeyModal
          open
          plainTextKey={revealState.key}
          keyName={revealState.name}
          onClose={() => setRevealState(null)}
        />
      )}
    </div>
  );
}

// ─── Key Row ────────────────────────────────────────────────
function KeyRow({
  apiKey,
  onRevoke,
  onDelete,
  onRename,
}: {
  apiKey: ApiKeyRecord;
  onRevoke: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const status = keyStatus(apiKey);

  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <h3 className="truncate text-sm font-medium text-text">{apiKey.name}</h3>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="font-mono">{apiKey.prefix}•••</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Created {relativeTime(apiKey.createdAt)}
          </span>
          {apiKey.lastUsedAt && (
            <span>Last used {relativeTime(apiKey.lastUsedAt)}</span>
          )}
          {apiKey.expiresAt && (
            <span className={isExpired(apiKey.expiresAt) ? "text-warning" : ""}>
              {isExpired(apiKey.expiresAt) ? "Expired" : "Expires"}{" "}
              {new Date(apiKey.expiresAt).toLocaleDateString()}
            </span>
          )}
        </div>
        {apiKey.scopes.length > 0 && !apiKey.scopes.includes("*") && (
          <div className="mt-2 flex flex-wrap gap-1">
            {apiKey.scopes.map((s) => (
              <span
                key={s}
                className="rounded border border-border bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      <KeyActions apiKey={apiKey} onRevoke={onRevoke} onDelete={onDelete} onRename={onRename} />
    </Card>
  );
}
