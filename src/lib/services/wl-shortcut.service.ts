import 'server-only';

import {
  addTrackedProject,
  archiveTrackedProject,
  listTrackedProjects,
  getTrackedProject,
} from '@/lib/services/wl-tracker.service';
import { AppError } from '@/lib/api/errors';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trackedProjects } from '@/drizzle/schema/wl-tracker';

// ─── WL Telegram shortcut fast-path ──────────────────────────────────────
// Mirrors the existing `parseMintShortcut` / `executeMintShortcut` pattern:
// intercept a handful of slash commands BEFORE the AI interpreter fires so
// tracking works even when the user's AI provider is down or unconfigured.
//
// Supported commands:
//   /track @handle                          → start tracking @handle
//   /track @handle wallet:0xABC…            → tag which wallet applied
//   /track @handle mint:2024-12-15T18:00Z   → set expected mint date (raises polling near mint time)
//   /track @handle form:premint             → tag the WL form platform
//   /untrack @handle                        → archive an existing tracked project
//   /projects                               → list active tracked projects

export type WlShortcut =
  | { type: 'track'; handle: string; walletUsed?: string; expectedMintDate?: Date; formType?: WlFormType }
  | { type: 'untrack'; handle: string }
  | { type: 'projects' };

type WlFormType = 'premint' | 'alphabot' | 'atlas3' | 'superful' | 'gleam' | 'google_form' | 'twitter_form' | 'discord' | 'other';
const FORM_TYPES: WlFormType[] = ['premint', 'alphabot', 'atlas3', 'superful', 'gleam', 'google_form', 'twitter_form', 'discord', 'other'];

// ─── Parse ───────────────────────────────────────────────────────────────

export function parseWlShortcut(input: string): WlShortcut | null {
  const text = input.trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  // /projects
  if (lower === '/projects' || lower === '/tracking' || lower === '/wl') {
    return { type: 'projects' };
  }

  // /track <handle> [key:value ...]
  const trackMatch = text.match(/^\/(track|watchproject|wladd)\s+(\S+)(.*)$/i);
  if (trackMatch) {
    const handle = trackMatch[2];
    const rest = trackMatch[3] ?? '';
    const opts = parseKeyValueOptions(rest);
    const shortcut: WlShortcut = { type: 'track', handle };
    if (opts.wallet) shortcut.walletUsed = opts.wallet;
    if (opts.mint) {
      const d = new Date(opts.mint);
      if (!isNaN(d.getTime())) shortcut.expectedMintDate = d;
    }
    if (opts.form) {
      const f = opts.form.toLowerCase() as WlFormType;
      if (FORM_TYPES.includes(f)) shortcut.formType = f;
    }
    return shortcut;
  }

  // /untrack <handle>
  const untrackMatch = text.match(/^\/(untrack|wlremove)\s+(\S+)/i);
  if (untrackMatch) {
    return { type: 'untrack', handle: untrackMatch[2] };
  }

  return null;
}

// ─── Natural-language parser ─────────────────────────────────────────────
// The user asked for the shortest possible Telegram UX: just mention a
// Twitter handle and the bot starts tracking. This parser accepts anything
// that looks like a track/untrack intent WITHOUT requiring a slash command.
//
// Examples that all trigger tracking:
//   @pudgypenguins
//   @pudgypenguins track it
//   track @pudgypenguins
//   watch @pudgypenguins wallet 0xABC…
//   monitor @pudgypenguins mint 2026-08-15
//   add @pudgypenguins to tracker
//
// Examples that trigger untracking:
//   untrack @pudgypenguins
//   stop watching @pudgypenguins
//   remove @pudgypenguins
//
// Returns null if the message doesn't clearly reference a Twitter handle
// with a track/untrack intent — caller then falls back to the AI interpreter.

const HANDLE_RE = /(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{1,20})\b/;
const TWITTER_URL_RE = /(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,20})\b/;
const WALLET_RE = /\b(0x[a-fA-F0-9]{40})\b/;
// ISO 8601 date (YYYY-MM-DD, optionally with THH:MM:SSZ).
const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)\b/;

const TRACK_VERBS = [
  'track', 'watch', 'add', 'monitor', 'follow it', 'follow this',
  'observe', 'keep an eye', 'notify', 'alert me', 'listen to',
];
const UNTRACK_VERBS = [
  'untrack', 'stop watching', 'stop tracking', 'remove', 'unwatch',
  'disable', 'delete', 'forget',
];

export function parseWlNaturalMessage(input: string): WlShortcut | null {
  const raw = input.trim();
  if (!raw || raw.startsWith('/')) return null;   // slash commands handled elsewhere

  // Extract handle from an @mention or a twitter.com/x.com URL.
  let handle: string | null = null;
  const atMatch = raw.match(HANDLE_RE);
  if (atMatch) handle = atMatch[1];
  else {
    const urlMatch = raw.match(TWITTER_URL_RE);
    if (urlMatch) handle = urlMatch[1];
  }
  if (!handle) return null;

  const lower = raw.toLowerCase();

  // Untrack intent takes precedence — "stop tracking @foo" should never be
  // interpreted as "start tracking @foo".
  if (UNTRACK_VERBS.some((v) => lower.includes(v))) {
    return { type: 'untrack', handle };
  }

  // Accept as a track intent if:
  //   (a) the message is JUST the @handle (with maybe whitespace/emoji), or
  //   (b) it contains a recognized track verb.
  const bareHandle = raw.replace(/[^\w]/g, '').toLowerCase() === handle.toLowerCase();
  const hasTrackVerb = TRACK_VERBS.some((v) => lower.includes(v));
  if (!bareHandle && !hasTrackVerb) return null;

  const shortcut: WlShortcut = { type: 'track', handle };

  // Optional inline wallet address (unlabeled: "track @foo 0xABC…").
  const walletMatch = raw.match(WALLET_RE);
  if (walletMatch) shortcut.walletUsed = walletMatch[1];

  // Optional mint date (unlabeled: "watch @foo mint 2026-08-15").
  const dateMatch = raw.match(ISO_DATE_RE);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d.getTime())) shortcut.expectedMintDate = d;
  }

  // Optional labeled options (form:premint etc.) — reuse the slash parser.
  const kv = parseKeyValueOptions(raw);
  if (kv.wallet) shortcut.walletUsed = kv.wallet;
  if (kv.form) {
    const f = kv.form.toLowerCase() as WlFormType;
    if (FORM_TYPES.includes(f)) shortcut.formType = f;
  }
  if (kv.mint) {
    const d = new Date(kv.mint);
    if (!isNaN(d.getTime())) shortcut.expectedMintDate = d;
  }

  return shortcut;
}

function parseKeyValueOptions(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+):(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    result[match[1].toLowerCase()] = match[2];
  }
  return result;
}

// ─── Execute ─────────────────────────────────────────────────────────────

export async function executeWlShortcut(shortcut: WlShortcut, userId: string): Promise<string> {
  if (shortcut.type === 'projects') {
    const projects = await listTrackedProjects(userId);
    if (projects.length === 0) {
      return 'You are not tracking any projects yet.\n\nUse `/track @handle` after filling a WL form to have the bot watch that project for winner announcements.';
    }
    const lines = [`📋 Tracking ${projects.length} project${projects.length === 1 ? '' : 's'}:`, ''];
    for (const p of projects.slice(0, 20)) {
      const wallet = p.walletUsed ? ` · 💼 ${p.walletUsed.slice(0, 6)}…${p.walletUsed.slice(-4)}` : '';
      const mint = p.expectedMintDate ? ` · 📅 ${new Date(p.expectedMintDate).toISOString().slice(0, 16)}Z` : '';
      const status = p.isActive ? '✅' : '⏸️';
      lines.push(`${status} ${p.twitterHandle}${wallet}${mint}`);
    }
    if (projects.length > 20) {
      lines.push('', `…and ${projects.length - 20} more (see the web dashboard).`);
    }
    return lines.join('\n');
  }

  if (shortcut.type === 'untrack') {
    const handle = normalizeForLookup(shortcut.handle);
    const [existing] = await getDb()
      .select()
      .from(trackedProjects)
      .where(and(
        eq(trackedProjects.userId, userId),
        eq(trackedProjects.twitterHandle, handle),
      ))
      .limit(1);
    if (!existing) {
      return `⚠️ You are not tracking ${handle}.`;
    }
    await archiveTrackedProject(userId, existing.id);
    return `🗑️ Stopped tracking ${handle}.`;
  }

  // shortcut.type === 'track'
  try {
    const project = await addTrackedProject(userId, {
      handle: shortcut.handle,
      walletUsed: shortcut.walletUsed,
      expectedMintDate: shortcut.expectedMintDate,
      formType: shortcut.formType,
    });
    const lines = [
      `✅ Now watching <b>${project.projectName}</b> (${project.twitterHandle})`,
      '',
      'I will Telegram you when they post about:',
      '• 🚨 Winner announcements',
      '• 🔔 Mint links',
      '• 📢 Mint reminders / delays',
    ];
    if (project.walletUsed) {
      lines.push('', `💼 Applied with wallet: <code>${project.walletUsed}</code>`);
    }
    if (project.expectedMintDate) {
      lines.push(
        '',
        `📅 Mint date noted — I'll poll every 5 minutes as it approaches.`,
      );
    }
    lines.push('', 'Use <code>/projects</code> to see everything you\'re watching.');
    return lines.join('\n');
  } catch (error) {
    if (error instanceof AppError) {
      return `⚠️ ${error.message}`;
    }
    throw error;
  }
}

function normalizeForLookup(handle: string): string {
  const trimmed = handle.trim().replace(/^@+/, '').toLowerCase();
  const urlMatch = trimmed.match(/(?:twitter\.com|x\.com)\/([a-z0-9_]+)/);
  return `@${urlMatch ? urlMatch[1] : trimmed}`;
}
