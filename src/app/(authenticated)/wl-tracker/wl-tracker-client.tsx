'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, ExternalLink, Flame, Plus, Trash2 } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonCard } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api/client';

// ─── Types (mirror what /api/wl-tracker returns) ────────────────────────

type TrackedProject = {
  id: string;
  twitterHandle: string;
  projectName: string;
  projectAvatarUrl: string | null;
  walletUsed: string | null;
  formType: string | null;
  formUrl: string | null;
  notes: string | null;
  expectedMintDate: string | null;
  hasDailyCheckin: boolean;
  dailyCheckinUrl: string | null;
  isActive: boolean;
  lastCheckedAt: string | null;
  pollFrequencyMinutes: number;
  consecutiveErrors: number;
  createdAt: string;
};

type PendingCheckin = {
  projectId: string;
  projectName: string;
  twitterHandle: string;
  projectAvatarUrl: string | null;
  dailyCheckinUrl: string | null;
  dailyCheckinTimeHint: string | null;
  lastDoneAt: string | null;
  streakDays: number;
};

type TrackedTweet = {
  id: string;
  projectId: string;
  tweetId: string;
  tweetUrl: string;
  tweetText: string;
  postedAt: string;
  authorHandle: string;
  category: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  aiSummary: string | null;
  extractedMintUrl: string | null;
  walletMatched: boolean;
  userMarkedAsRead: boolean;
  userMarkedAsWinner: boolean;
  createdAt: string;
};

// ─── Urgency styling ─────────────────────────────────────────────────────

const URGENCY_ORDER: TrackedTweet['urgency'][] = ['critical', 'high', 'medium', 'low'];
const URGENCY_LABEL: Record<TrackedTweet['urgency'], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const URGENCY_CLASS: Record<TrackedTweet['urgency'], string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-amber-100 text-amber-700 border-amber-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};
const CATEGORY_LABEL: Record<string, string> = {
  winners_announcement: 'Winners announced',
  mint_link: 'Mint link',
  mint_reminder: 'Mint reminder',
  delay_postpone: 'Mint delayed',
  general_hype: 'Update',
  unrelated: 'Unrelated',
};

// ─── Component ───────────────────────────────────────────────────────────

export default function WlTrackerClient() {
  const qc = useQueryClient();
  const [isAddOpen, setAddOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['wl-tracker', 'projects'],
    queryFn: () => apiRequest<{ projects: TrackedProject[] }>('/api/wl-tracker'),
  });

  // Detect user's browser timezone once — used for the pending check-ins query
  // so "today" is calculated in their local wall clock, not UTC.
  const userTz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  }, []);

  const checkinsQuery = useQuery({
    queryKey: ['wl-tracker', 'checkins', 'pending', userTz],
    queryFn: () => apiRequest<{ pending: PendingCheckin[] }>(
      `/api/wl-tracker/checkin?mode=pending&tz=${encodeURIComponent(userTz)}`,
    ),
    refetchInterval: 60_000, // freshen every minute so streaks update
  });

  const tweetsQuery = useQuery({
    queryKey: ['wl-tracker', 'tweets', selectedProjectId ?? 'all'],
    queryFn: () => {
      const qs = selectedProjectId ? `?projectId=${selectedProjectId}` : '';
      return apiRequest<{ tweets: TrackedTweet[] }>(`/api/wl-tracker/tweets${qs}`);
    },
  });

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest<{ project: TrackedProject }>('/api/wl-tracker', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wl-tracker', 'projects'] });
      setAddOpen(false);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/wl-tracker/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wl-tracker', 'projects'] }),
  });

  const markReadMutation = useMutation({
    mutationFn: (tweetId: string) =>
      apiRequest('/api/wl-tracker/tweets', {
        method: 'PATCH',
        body: { tweetId, action: 'read' },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wl-tracker', 'tweets'] }),
  });

  const checkinDoneMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiRequest('/api/wl-tracker/checkin', {
        method: 'POST',
        body: { projectId, source: 'web' },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wl-tracker', 'checkins'] });
    },
  });

  const sortedTweets = useMemo(() => {
    const list = tweetsQuery.data?.tweets ?? [];
    // Sort by (urgency asc, postedAt desc) — critical first, newest first.
    return [...list].sort((a, b) => {
      const u = URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency);
      if (u !== 0) return u;
      return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
    });
  }, [tweetsQuery.data]);

  const projects = projectsQuery.data?.projects ?? [];
  const unreadCount = (tweetsQuery.data?.tweets ?? []).filter((t) => !t.userMarkedAsRead).length;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="WL Tracker"
        subtitle="Watch project Twitter accounts for winner announcements and mint links."
        icon={Bell}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Track project
          </Button>
        }
      />

      {/* ── Today's check-ins ─────────────────────────────────────────
          The personal-assistant surface. Shows only projects with a
          daily-check-in obligation that hasn't been completed today. */}
      <TodaysCheckins
        pending={checkinsQuery.data?.pending ?? []}
        loading={checkinsQuery.isLoading}
        onDone={(projectId) => checkinDoneMutation.mutate(projectId)}
        doneInFlight={checkinDoneMutation.isPending}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">
        {/* ── Left: tracked projects ───────────────────────────────────── */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Projects</div>
            <Badge variant="info">{projects.length}</Badge>
          </div>

          {projectsQuery.isLoading ? (
            <div className="space-y-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-sm text-muted">
              Nothing tracked yet. Add a project after filling its WL form.
            </div>
          ) : (
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => setSelectedProjectId(null)}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 ${
                    selectedProjectId === null ? 'bg-slate-100 font-medium' : ''
                  }`}
                >
                  All projects
                </button>
              </li>
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedProjectId(p.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 ${
                      selectedProjectId === p.id ? 'bg-slate-100' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {p.projectAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.projectAvatarUrl} alt="" className="h-6 w-6 flex-shrink-0 rounded-full" />
                      ) : (
                        <div className="h-6 w-6 flex-shrink-0 rounded-full bg-slate-200" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.projectName}</div>
                        <div className="truncate text-xs text-muted">{p.twitterHandle}</div>
                      </div>
                    </div>
                    {p.consecutiveErrors >= 3 && (
                      <Badge variant="danger" className="text-[10px]">err</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Right: tweet feed ────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted">
              {selectedProjectId ? 'Feed for selected project' : 'All important tweets across your projects'}
            </div>
            <Badge variant="info">{unreadCount} unread</Badge>
          </div>

          {tweetsQuery.isLoading ? (
            <div className="space-y-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : sortedTweets.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notable tweets yet"
              description="The watcher polls every few minutes. Anything about winners, mint links, or delays will land here."
            />
          ) : (
            <ul className="space-y-3">
              {sortedTweets.map((t) => {
                const project = projects.find((p) => p.id === t.projectId);
                return (
                  <li key={t.id}>
                    <Card className={`p-4 ${t.userMarkedAsRead ? 'opacity-60' : ''}`}>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge className={`border ${URGENCY_CLASS[t.urgency]}`}>{URGENCY_LABEL[t.urgency]}</Badge>
                        <Badge variant="info">{CATEGORY_LABEL[t.category] ?? t.category}</Badge>
                        {t.walletMatched && (
                          <Badge className="border border-purple-200 bg-purple-100 text-purple-700">
                            ⚡ Your wallet mentioned
                          </Badge>
                        )}
                        {project && <span className="text-xs text-muted">{project.projectName} · {t.authorHandle}</span>}
                        <span className="ml-auto text-xs text-muted">
                          {new Date(t.postedAt).toLocaleString()}
                        </span>
                      </div>

                      {t.aiSummary && (
                        <div className="mb-2 text-sm font-medium">{t.aiSummary}</div>
                      )}
                      <div className="mb-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {t.tweetText.slice(0, 400)}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <a href={t.tweetUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="secondary" size="sm">
                            <ExternalLink className="mr-1 h-3 w-3" /> Open tweet
                          </Button>
                        </a>
                        {t.extractedMintUrl && (
                          <a href={t.extractedMintUrl} target="_blank" rel="noopener noreferrer">
                            <Button size="sm">🔗 Mint link</Button>
                          </a>
                        )}
                        {!t.userMarkedAsRead && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => markReadMutation.mutate(t.id)}
                          >
                            Mark read
                          </Button>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Add-project modal ────────────────────────────────────────── */}
      <AddProjectModal
        open={isAddOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(payload) => addMutation.mutate(payload)}
        submitting={addMutation.isPending}
        errorMessage={addMutation.error ? (addMutation.error as Error).message : null}
      />

      {/* ── Selected project: remove button ──────────────────────────── */}
      {selectedProjectId && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (confirm('Stop tracking this project?')) {
                archiveMutation.mutate(selectedProjectId);
                setSelectedProjectId(null);
              }
            }}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Stop tracking
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Today's check-ins section ───────────────────────────────────────────
// Compact row of "still-to-do" cards. Empty state hides the section entirely
// (no "you're all caught up" noise), except when loading.
function TodaysCheckins({
  pending,
  loading,
  onDone,
  doneInFlight,
}: {
  pending: PendingCheckin[];
  loading: boolean;
  onDone: (projectId: string) => void;
  doneInFlight: boolean;
}) {
  if (loading) {
    return <SkeletonCard />;
  }
  if (pending.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold">
            Today&apos;s check-ins — {pending.length} pending
          </h3>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {pending.map((p) => (
          <div
            key={p.projectId}
            className="flex items-center gap-3 rounded-md border border-border p-3"
          >
            {p.projectAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.projectAvatarUrl} alt="" className="h-8 w-8 flex-shrink-0 rounded-full" />
            ) : (
              <div className="h-8 w-8 flex-shrink-0 rounded-full bg-slate-200" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 truncate text-sm font-medium">
                {p.projectName}
                {p.streakDays > 0 && (
                  <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    <Flame className="h-3 w-3" /> {p.streakDays}
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-muted">{p.twitterHandle}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {p.dailyCheckinUrl && (
                <a
                  href={p.dailyCheckinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Open ↗
                </a>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={doneInFlight}
                onClick={() => onDone(p.projectId)}
              >
                Done
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Add project modal ───────────────────────────────────────────────────

function AddProjectModal({
  open,
  onClose,
  onSubmit,
  submitting,
  errorMessage,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  submitting: boolean;
  errorMessage: string | null;
}) {
  const [handle, setHandle] = useState('');
  const [walletUsed, setWalletUsed] = useState('');
  const [notes, setNotes] = useState('');
  const [hasDailyCheckin, setHasDailyCheckin] = useState(false);
  const [dailyCheckinUrl, setDailyCheckinUrl] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="Track a project">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            handle: handle.trim(),
            walletUsed: walletUsed.trim() || null,
            notes: notes.trim() || null,
            hasDailyCheckin,
            dailyCheckinUrl: hasDailyCheckin && dailyCheckinUrl.trim() ? dailyCheckinUrl.trim() : null,
          });
        }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium">Twitter handle</label>
          <Input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@pudgypenguins or twitter.com/pudgypenguins"
            required
            autoFocus
          />
          <p className="mt-1 text-xs text-muted">
            You can paste any of: @handle, twitter.com/handle, or a full tweet URL.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Wallet you applied with</label>
          <Input
            value={walletUsed}
            onChange={(e) => setWalletUsed(e.target.value)}
            placeholder="0x…"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Notes</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Did RT + follow + comment" />
        </div>

        {/* Daily check-in toggle — the AI assistant will remind you every
            morning about projects with this flag on. */}
        <div className="rounded-md border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={hasDailyCheckin}
              onChange={(e) => setHasDailyCheckin(e.target.checked)}
              className="h-4 w-4"
            />
            Daily check-in required
          </label>
          <p className="mt-1 text-xs text-muted">
            Turn on if this project asks you to visit / click / retweet daily to keep your WL. You&apos;ll get a morning digest of every project pending today.
          </p>
          {hasDailyCheckin && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium">Check-in URL (optional)</label>
              <Input
                value={dailyCheckinUrl}
                onChange={(e) => setDailyCheckinUrl(e.target.value)}
                placeholder="https://project.xyz/checkin"
              />
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!handle.trim() || submitting}>
            {submitting ? 'Adding…' : 'Track project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
