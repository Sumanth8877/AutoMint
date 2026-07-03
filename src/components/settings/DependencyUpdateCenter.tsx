'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ArrowUpCircle, CheckCircle2, ChevronDown, ChevronUp,
  ClipboardCheck, ClipboardCopy, Download, ExternalLink, Package,
  RefreshCw, ShieldAlert, XCircle, Zap,
  CalendarClock, Flame, Activity,
} from 'lucide-react';
import type {
  DependencyAuditReport,
  PackageAuditResult,
  ModernizationOpportunity,
  SecuritySeverity,
  UpdateClassification,
} from '@/lib/services/dependency-audit.service';

// ─────────────────────────────────────────────────────────────────
// Mint-Critical packages — directly used in the mint execution path
// ─────────────────────────────────────────────────────────────────
const MINT_CRITICAL_PACKAGES = new Set([
  'viem', '@upstash/qstash', '@upstash/redis', '@clerk/nextjs',
  '@neondatabase/serverless', 'drizzle-orm', 'next', 'react', 'react-dom',
  'zod', '@tanstack/react-query',
]);

function isMintCritical(name: string): boolean {
  return MINT_CRITICAL_PACKAGES.has(name);
}

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type Tab = 'safe' | 'minor' | 'breaking' | 'security' | 'mint-critical' | 'modernization' | 'all';
type ActionState = 'idle' | 'loading' | 'success' | 'error';

interface InstallResult {
  updated: string[];
  commitSha?: string;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────
// Arc Gauge — neon semicircular score display
// ─────────────────────────────────────────────────────────────────

function ArcGauge({ score, label }: { score: number; label: string }) {
  const size = 80;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius; // semicircle
  const filled = (score / 100) * circumference;
  const color = score >= 80 ? '#4F46E5' : score >= 60 ? '#F59E0B' : '#FF4D4D';
  const glowColor = score >= 80 ? 'rgba(79,70,229,0.25)' : score >= 60 ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)';
  const bgClass = score >= 80
    ? 'border-success/20 bg-emerald-50'
    : score >= 60
    ? 'border-warning/20 bg-amber-50'
    : 'border-danger/20 bg-red-50';

  return (
    <div className={`flex flex-1 min-w-0 flex-col items-center gap-1.5 rounded-xl border px-2 py-4 ${bgClass}`}>
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
        {/* Background arc */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{
            transition: 'stroke-dasharray 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            filter: `drop-shadow(0 0 6px ${glowColor})`,
          }}
        />
        {/* Score text */}
        <text
          x={size / 2}
          y={size / 2 - 6}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: 22, fontWeight: 800, fill: color }}
        >
          {score}
        </text>
      </svg>
      <span className="text-xs font-bold uppercase tracking-[0.15em] text-muted">{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stat tile — neon styled
// ─────────────────────────────────────────────────────────────────

function StatTile({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'good' | 'warn' | 'danger' | 'info' }) {
  const styles = {
    neutral: 'border-border bg-surface-hover text-secondary',
    good:    'border-success/20 bg-emerald-50 text-success',
    warn:    'border-warning/20 bg-amber-50 text-warning',
    danger:  'border-danger/20 bg-red-50 text-danger',
    info:    'border-primary/20 bg-indigo-50 text-primary',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${styles}`}>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs font-bold uppercase tracking-wider mt-0.5 opacity-75">{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Classification badge — neon styled
// ─────────────────────────────────────────────────────────────────

function ClassBadge({ classification }: { classification: UpdateClassification }) {
  if (classification === 'SAFE') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-success">
      <CheckCircle2 className="h-3 w-3" /> Safe
    </span>
  );
  if (classification === 'MINOR_REVIEW') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-warning">
      ~ Review
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-danger/20 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-danger">
      <XCircle className="h-3 w-3" /> Breaking
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Severity badge — neon styled
// ─────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: SecuritySeverity }) {
  const map: Record<SecuritySeverity, string> = {
    CRITICAL: 'border-danger/40 bg-danger/20 text-danger shadow-[0_0_8px_rgba(239,68,68,0.25)]',
    HIGH:     'border-warning/40 bg-warning/20 text-warning',
    MEDIUM:   'border-warning/20 bg-amber-50 text-warning/80',
    LOW:      'border-border bg-surface-hover text-muted',
  };
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-bold ${map[severity]}`}>
      {severity}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Mint-Critical badge
// ─────────────────────────────────────────────────────────────────

function MintCriticalBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-indigo-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-primary"
      style={{ boxShadow: '0 0 8px rgba(79,70,229,0.08)' }}
    >
      <Flame className="h-2.5 w-2.5" /> Mint
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Neon checkbox
// ─────────────────────────────────────────────────────────────────

function NeonCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        checked
          ? 'border-primary bg-primary/20 shadow-[0_0_8px_rgba(79,70,229,0.20)]'
          : 'border-border bg-surface-hover hover:border-border-strong'
      }`}
    >
      {checked && <CheckCircle2 className="h-3 w-3 text-primary" strokeWidth={2.5} />}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Package row — with risk coloring, changelog link, mint-critical badge
// ─────────────────────────────────────────────────────────────────

function PackageRow({ pkg, selected, onToggle, showSelect }: {
  pkg: PackageAuditResult; selected: boolean; onToggle: () => void; showSelect: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = pkg.securityAdvisories.length > 0 || !!pkg.deprecationMessage;
  const critical = isMintCritical(pkg.name);

  // Row risk coloring
  const rowBorder = pkg.securityRisk
    ? 'border-l-2 border-l-danger/60'
    : pkg.classification === 'BREAKING'
    ? 'border-l-2 border-l-danger/40'
    : pkg.classification === 'MINOR_REVIEW'
    ? 'border-l-2 border-l-warning/40'
    : pkg.classification === 'SAFE' && pkg.updateType !== 'current'
    ? 'border-l-2 border-l-success/40'
    : 'border-l-2 border-l-transparent';

  const rowBg = pkg.securityRisk
    ? 'bg-danger/[0.04]'
    : '';

  // Changelog URL: use changelogUrl, or derive from homepage/repo
  const changelogUrl = pkg.changelogUrl
    || (pkg.homepage ? pkg.homepage : null);

  return (
    <>
      <tr className={`border-b border-border transition-colors hover:bg-surface-hover ${rowBorder} ${rowBg}`}>
        {showSelect && (
          <td className="pl-4 py-3 w-10">
            {pkg.updateType !== 'current' && (
              <NeonCheckbox checked={selected} onChange={onToggle} label={`Select ${pkg.name}`} />
            )}
          </td>
        )}
        <td className="px-4 py-3 max-w-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="text-sm font-semibold text-text font-mono">{pkg.name}</code>
            {critical && <MintCriticalBadge />}
            {pkg.isDev && <span className="rounded bg-surface-hover px-1.5 py-0.5 text-xs font-medium text-muted">dev</span>}
            {pkg.deprecated && <span className="rounded border border-warning/20 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-warning">deprecated</span>}
            {pkg.isAbandoned && <span className="rounded bg-surface-hover px-1.5 py-0.5 text-xs font-medium text-muted">abandoned</span>}
          </div>
          {pkg.updateType !== 'current' && (
            <div className="mt-0.5 text-[11px] text-muted font-mono">
              {pkg.currentVersion} → {pkg.latestVersion}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-sm font-mono text-muted w-28">{pkg.currentVersion}</td>
        <td className="px-4 py-3 w-28">
          <span className={`text-sm font-mono ${pkg.updateType === 'current' ? 'text-muted' : 'font-bold text-text'}`}>
            {pkg.latestVersion}
          </span>
        </td>
        <td className="px-4 py-3 w-32">
          {pkg.updateType === 'current' ? <span className="text-xs text-muted">—</span> : <ClassBadge classification={pkg.classification} />}
        </td>
        <td className="px-4 py-3 w-28">
          {pkg.securitySeverity ? <SeverityBadge severity={pkg.securitySeverity} /> : <span className="text-xs text-muted">—</span>}
        </td>
        <td className="px-4 py-3 w-24">
          <div className="flex items-center gap-2">
            {/* Feature 6: Changelog link */}
            {changelogUrl && (
              <a
                href={changelogUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:text-primary hover:border-primary/30 transition-colors"
                title="View changelog / homepage"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {/* Expand details */}
            {hasDetails && (
              <button type="button" onClick={() => setExpanded(e => !e)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium">
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface-hover">
          <td colSpan={showSelect ? 7 : 6} className="px-6 pb-4 pt-2">
            <div className="space-y-2 text-sm">
              {pkg.deprecationMessage && (
                <div className="rounded-lg border border-warning/20 bg-amber-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-warning">Deprecated: </span>
                  <span className="text-warning/80">{pkg.deprecationMessage}</span>
                </div>
              )}
              {pkg.securityAdvisories.map(adv => (
                <div key={adv.id} className="rounded-lg border border-danger/20 bg-red-50 px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <SeverityBadge severity={adv.severity} />
                    <span className="font-semibold text-danger text-sm">{adv.title}</span>
                  </div>
                  <div className="text-xs text-danger/70 space-y-0.5">
                    <div>Affected: <code className="font-mono">{adv.affectedVersions}</code></div>
                    <div>Patched: <code className="font-mono">{adv.patchedVersions}</code></div>
                    {adv.cve && <div>CVE: <span className="font-mono font-bold">{adv.cve}</span></div>}
                    <a href={adv.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:text-primary/80 underline">
                      View Advisory <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))}
              {/* Changelog link in expanded view too */}
              {changelogUrl && (
                <a href={changelogUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80">
                  <ExternalLink className="h-3 w-3" /> View changelog / homepage
                </a>
              )}
              <p className="text-xs text-muted italic">{pkg.recommendation}</p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Package table
// ─────────────────────────────────────────────────────────────────

function PackageTable({ packages, selectedPackages, onToggle, showSelect }: {
  packages: PackageAuditResult[]; selectedPackages: Set<string>; onToggle: (name: string) => void; showSelect: boolean;
}) {
  if (packages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-12 text-center">
        <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
        <p className="text-sm font-medium text-muted">All clear — no packages in this category.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-hover text-[11px] font-bold text-muted uppercase tracking-wider">
          <tr>
            {showSelect && <th className="pl-4 py-3 w-10" />}
            <th className="px-4 py-3 text-left">Package</th>
            <th className="px-4 py-3 text-left w-28">Current</th>
            <th className="px-4 py-3 text-left w-28">Latest</th>
            <th className="px-4 py-3 text-left w-32">Classification</th>
            <th className="px-4 py-3 text-left w-28">Security</th>
            <th className="px-4 py-3 w-24 text-left">Changelog</th>
          </tr>
        </thead>
        <tbody>
          {packages.map(pkg => (
            <PackageRow key={pkg.name} pkg={pkg}
              selected={selectedPackages.has(pkg.name)}
              onToggle={() => onToggle(pkg.name)}
              showSelect={showSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Modernization card — neon styled
// ─────────────────────────────────────────────────────────────────

function ModernizationCard({ opp }: { opp: ModernizationOpportunity }) {
  const resolved = opp.status === 'resolved';
  const effortStyle = resolved
    ? 'border-success/20 bg-emerald-50 text-success'
    : { low: 'border-success/20 bg-emerald-50 text-success', medium: 'border-warning/20 bg-amber-50 text-warning', high: 'border-danger/20 bg-red-50 text-danger' }[opp.effort];
  const typeIcon = { 'deprecated-api': '⚠️', 'better-alternative': '💡', 'performance': '⚡', 'security-hardening': '🔒' }[opp.type];
  return (
    <div className={`rounded-xl border p-4 space-y-2.5 ${resolved ? 'border-success/20 bg-emerald-50' : 'border-border bg-surface'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {resolved
            ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            : <span>{typeIcon}</span>
          }
          <code className="text-sm font-semibold text-text font-mono">{opp.package}</code>
        </div>
        {resolved
          ? <span className="rounded-full border border-success/20 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold shrink-0 text-success">✓ Resolved</span>
          : <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize shrink-0 ${effortStyle}`}>{opp.effort} effort</span>
        }
      </div>
      <p className="text-sm text-muted">{opp.description}</p>
      <div className={`rounded-lg px-3 py-2 border ${resolved ? 'bg-emerald-50 border-success/15' : 'bg-indigo-50 border-primary/15'}`}>
        <p className={`text-xs font-semibold mb-0.5 ${resolved ? 'text-success' : 'text-primary'}`}>{resolved ? 'Status' : 'Recommendation'}</p>
        <p className={`text-xs ${resolved ? 'text-success/80' : 'text-primary/80'}`}>{opp.recommendation}</p>
      </div>
      {opp.docsUrl && (
        <a href={opp.docsUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80">
          View Documentation <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Toast — neon styled
// ─────────────────────────────────────────────────────────────────

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'info'; onClose: () => void }) {
  const styles = {
    success: 'border-success/40 text-text',
    error:   'border-danger/40 text-text',
    info:    'border-primary/20 text-text',
  }[type];
  const dot = { success: 'bg-success shadow-[0_0_6px_rgba(79,70,229,0.5)]', error: 'bg-danger shadow-[0_0_6px_rgba(239,68,68,0.5)]', info: 'bg-primary shadow-[0_0_6px_rgba(79,70,229,0.5)]' }[type];
  return (
    <div className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border bg-surface px-4 py-3 shadow-[0_12px_48px_rgba(0,0,0,0.08)] ${styles}`}>
      <div className="flex items-center gap-3">
        <div className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-sm flex-1">{message}</span>
        <button onClick={onClose} className="text-muted hover:text-text text-lg leading-none ml-2">×</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Auto-update schedule card (Feature 7)
// ─────────────────────────────────────────────────────────────────

function AutoUpdateCard({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  // Calculate next Sunday 2 AM
  const now = new Date();
  const nextRun = new Date(now);
  const daysUntilSunday = (7 - now.getDay()) % 7;
  nextRun.setDate(now.getDate() + (daysUntilSunday === 0 && now.getHours() >= 2 ? 7 : daysUntilSunday));
  nextRun.setHours(2, 0, 0, 0);

  const nextRunStr = nextRun.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`rounded-xl border p-4 transition-all duration-200 ${
      enabled
        ? 'border-primary/15 bg-primary/[0.04] shadow-[0_0_20px_rgba(79,70,229,0.04)]'
        : 'border-border bg-surface'
    }`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
            enabled ? 'border-primary/15 bg-indigo-50' : 'border-border bg-surface-hover'
          }`}>
            <CalendarClock className={`h-4 w-4 ${enabled ? 'text-primary' : 'text-muted'}`} />
          </div>
          <div>
            <p className="text-sm font-bold text-text">Scheduled Auto-Update</p>
            <p className="text-xs text-muted">
              {enabled
                ? <>Next run: <span className="text-primary font-semibold">{nextRunStr}</span> — safe patches only</>
                : 'Auto-apply safe patch updates weekly'
              }
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={onToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            enabled
              ? 'border-primary/50 bg-primary/20 shadow-[0_0_12px_rgba(79,70,229,0.12)]'
              : 'border-border bg-surface-hover'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full transition-all duration-200 ${
              enabled
                ? 'translate-x-6 bg-primary shadow-[0_0_8px_rgba(79,70,229,0.5)]'
                : 'translate-x-1 bg-muted'
            }`}
          />
        </button>
      </div>
      {enabled && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Activity className="h-3 w-3 text-primary animate-pulse" />
          <span>Commits package.json to GitHub → Vercel auto-deploys with updated packages</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────

export function DependencyUpdateCenter() {
  const [report, setReport] = useState<DependencyAuditReport | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('safe');
  const [selectedPackages, setSelectedPackages] = useState<Set<string>>(new Set());
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);

  const [checkState, setCheckState] = useState<ActionState>('idle');
  const [installState, setInstallState] = useState<ActionState>('idle');
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number; packageName: string } | null>(null);
  const [reportState, setReportState] = useState<ActionState>('idle');
  const [copied, setCopied] = useState(false);

  const evtSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => { evtSourceRef.current?.close(); };
  }, []);

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }, []);

  // ── Scan (SSE streaming) ──────────────────────────────────────
  const handleCheck = useCallback(async () => {
    setCheckState('loading'); setError(null); setScanProgress(null);
    const url = '/api/system/dependency-audit/stream?force=true';
    evtSourceRef.current?.close();

    return new Promise<void>((resolve) => {
      const evtSource = new EventSource(url);
      evtSourceRef.current = evtSource;

      evtSource.addEventListener('start', (e: Event) => {
        const data = JSON.parse((e as MessageEvent).data as string) as { total: number };
        setScanProgress({ processed: 0, total: data.total, packageName: '' });
      });

      evtSource.addEventListener('progress', (e: Event) => {
        const data = JSON.parse((e as MessageEvent).data as string) as { processed: number; total: number; packageName: string };
        setScanProgress(data);
      });

      evtSource.addEventListener('complete', (e: Event) => {
        const data = JSON.parse((e as MessageEvent).data as string) as { report: DependencyAuditReport; cached: boolean };
        evtSource.close();
        setScanProgress(null);
        setReport(data.report);
        setCheckState('success');
        setActiveTab('safe');
        setSelectedPackages(new Set());
        showToast(`Scan complete — ${data.report.totalPackages} packages checked in ${data.report.durationMs}ms`, 'success');
        resolve();
      });

      evtSource.addEventListener('error', (e: Event) => {
        evtSource.close();
        setScanProgress(null);
        let errorMsg = 'Audit failed';
        try { errorMsg = (JSON.parse((e as MessageEvent).data as string) as { message?: string }).message ?? errorMsg; } catch { /* default */ }
        setError(errorMsg); setCheckState('error'); showToast(errorMsg, 'error');
        resolve();
      });

      evtSource.onerror = () => {
        if (evtSource.readyState === EventSource.CLOSED) return;
        evtSource.close(); setScanProgress(null);
        const msg = 'Connection to scan stream lost';
        setError(msg); setCheckState('error'); showToast(msg, 'error');
        resolve();
      };
    });
  }, [showToast]);

  // ── Download Report ───────────────────────────────────────────
  const handleReport = useCallback(async () => {
    setReportState('loading');
    try {
      const res = await fetch('/api/system/upgrade-report?format=markdown');
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Report generation failed'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `automint-upgrade-report-${new Date().toISOString().split('T')[0]}.md`;
      a.click(); URL.revokeObjectURL(url);
      setReportState('success'); showToast('Upgrade report downloaded.', 'success');
    } catch (err) { setReportState('error'); showToast(err instanceof Error ? err.message : 'Report failed', 'error'); }
  }, [showToast]);

  // ── Install Safe Updates ──────────────────────────────────────
  const handleInstall = useCallback(async () => {
    setInstallState('loading');
    setInstallResult(null);
    const pkgNames = selectedPackages.size > 0 ? Array.from(selectedPackages) : undefined;

    try {
      const res = await fetch('/api/system/install-safe-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageNames: pkgNames }),
      });
      const data = await res.json() as InstallResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Install failed');

      setInstallResult(data);
      setInstallState('success');
      showToast(data.message ?? `${data.updated.length} package(s) updated — Vercel redeploying…`, 'success');
    } catch (err) {
      setInstallState('error');
      showToast(err instanceof Error ? err.message : 'Install failed', 'error');
    }
  }, [selectedPackages, showToast]);

  // ── Copy install command ──────────────────────────────────────
  const handleCopyInstall = useCallback(() => {
    const safePkgs = report?.packages.filter(p =>
      p.classification === 'SAFE' && p.updateType !== 'current' &&
      (selectedPackages.size === 0 || selectedPackages.has(p.name))
    ) ?? [];
    const cmd = safePkgs.map(p => `${p.name}@${p.latestVersion}`).join(' ');
    if (!cmd) return;
    navigator.clipboard.writeText(`npm install ${cmd}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000); })
      .catch(() => undefined);
  }, [report, selectedPackages]);

  const togglePackage = useCallback((name: string) => {
    setSelectedPackages(prev => {
      const n = new Set(prev);
      if (n.has(name)) { n.delete(name); } else { n.add(name); }
      return n;
    });
  }, []);

  // ── Derived values ────────────────────────────────────────────
  const filteredPackages = report?.packages.filter(p => {
    if (activeTab === 'all') return true;
    if (activeTab === 'safe') return p.classification === 'SAFE' && p.updateType !== 'current';
    if (activeTab === 'minor') return p.classification === 'MINOR_REVIEW';
    if (activeTab === 'breaking') return p.classification === 'BREAKING';
    if (activeTab === 'security') return p.securityRisk;
    if (activeTab === 'mint-critical') return isMintCritical(p.name) && p.updateType !== 'current';
    return true;
  }) ?? [];

  const safeCount = report?.safeUpdates ?? 0;
  const minorCount = report?.minorReviewUpdates ?? 0;
  const breakingCount = report?.breakingUpdates ?? 0;
  const securityCount = report?.packages.filter(p => p.securityRisk).length ?? 0;
  const mintCriticalCount = report?.packages.filter(p => isMintCritical(p.name) && p.updateType !== 'current').length ?? 0;
  const modernCount = report?.modernizationOpportunities.filter(o => o.status !== 'resolved').length ?? 0;
  const isScanning = checkState === 'loading';

  const tabs: { id: Tab; label: string; count: number; color: string }[] = [
    { id: 'safe',          label: 'Safe',          count: safeCount,          color: 'green' },
    { id: 'minor',         label: 'Review',        count: minorCount,         color: 'yellow' },
    { id: 'breaking',      label: 'Breaking',      count: breakingCount,      color: 'red' },
    { id: 'security',      label: 'Security',      count: securityCount,      color: 'red' },
    { id: 'mint-critical', label: 'Mint-Critical', count: mintCriticalCount,  color: 'neon' },
    { id: 'modernization', label: 'Modernization', count: modernCount,        color: 'indigo' },
    { id: 'all',           label: 'All',           count: report?.totalPackages ?? 0, color: 'gray' },
  ];

  const tabActiveStyle: Record<string, string> = {
    green:  'bg-emerald-50 text-success ring-1 ring-success/30',
    yellow: 'bg-amber-50 text-warning ring-1 ring-warning/30',
    red:    'bg-red-50 text-danger ring-1 ring-danger/30',
    neon:   'bg-indigo-50 text-primary ring-1 ring-primary/30',
    indigo: 'bg-indigo-50 text-primary ring-1 ring-primary/30',
    gray:   'bg-surface-hover text-secondary',
  };

  const tabCountStyle: Record<string, string> = {
    green:  'bg-success/20 text-success',
    yellow: 'bg-warning/20 text-warning',
    red:    'bg-danger/20 text-danger',
    neon:   'bg-primary/20 text-primary',
    indigo: 'bg-primary/20 text-primary',
    gray:   'bg-surface-hover text-secondary',
  };

  return (
    <section className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/15 bg-indigo-50"
              style={{ boxShadow: '0 0 16px rgba(79,70,229,0.06)' }}
            >
              <Package className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-lg font-bold tracking-tight text-text">Dependency Update Center</h2>
            {report && (
              <span className="rounded-full border border-success/20 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-success">
                Scanned
              </span>
            )}
          </div>
          <p className="text-sm text-muted max-w-xl">
            Keep your app healthy and up to date. Scan packages for updates, security issues, and outdated dependencies.
          </p>
        </div>

        <button
          type="button"
          onClick={() => { void handleCheck(); }}
          disabled={isScanning}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-primary/20 bg-indigo-50 px-5 py-2.5 text-sm font-bold text-primary hover:bg-primary/20 hover:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-all"
          style={{ boxShadow: '0 0 20px rgba(79,70,229,0.05)' }}
        >
          <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
          {isScanning ? 'Scanning…' : 'Check for Updates'}
        </button>
      </div>

      {/* ── Error banner ───────────────────────────────────────── */}
      {error && !report && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/20 bg-red-50 px-4 py-3">
          <XCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-danger">Scan failed</p>
            <p className="text-sm text-danger">{error}</p>
          </div>
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────── */}
      {!report && !isScanning && (
        <div className="rounded-2xl border-2 border-dashed border-border py-20 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-indigo-50 mb-4"
            style={{ boxShadow: '0 0 24px rgba(79,70,229,0.04)' }}
          >
            <Package className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-base font-bold text-text mb-1">No audit data yet</h3>
          <p className="text-sm text-muted mb-6">
            Click <strong className="text-primary">Check for Updates</strong> to scan all npm dependencies against the registry.
          </p>
          <button onClick={() => { void handleCheck(); }}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-indigo-50 px-5 py-2.5 text-sm font-bold text-primary hover:bg-primary/20 transition-all">
            <RefreshCw className="h-4 w-4" /> Scan Now
          </button>
        </div>
      )}

      {/* ── Loading state with progress bar ────────────────────── */}
      {isScanning && !report && (
        <div className="rounded-2xl border border-border bg-surface py-14 px-8 text-center space-y-5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-indigo-50">
            <RefreshCw className="h-8 w-8 text-primary animate-spin" />
          </div>
          <div>
            <p className="text-sm font-bold text-text mb-1">
              {scanProgress ? `Auditing ${scanProgress.packageName || '…'}` : 'Connecting to npm registry…'}
            </p>
            <p className="text-xs text-muted">
              {scanProgress
                ? `${scanProgress.processed} / ${scanProgress.total} packages checked`
                : 'Fetching metadata for all packages. This usually takes 5–15 seconds.'}
            </p>
          </div>
          {scanProgress && scanProgress.total > 0 && (
            <div className="mx-auto max-w-sm space-y-1.5">
              <div className="h-2 w-full rounded-full bg-surface-hover overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round((scanProgress.processed / scanProgress.total) * 100)}%`,
                    background: 'linear-gradient(90deg, #4F46E5, #4F46E5)',
                    boxShadow: '0 0 8px rgba(79,70,229,0.25)',
                  }}
                />
              </div>
              <p className="text-right text-xs font-mono text-muted">
                {Math.round((scanProgress.processed / scanProgress.total) * 100)}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Report dashboard ───────────────────────────────────── */}
      {report && (
        <>
          {/* Meta row */}
          <div className="text-xs text-muted">
            Last scanned: <span className="font-medium text-secondary">{new Date(report.auditedAt).toLocaleString()}</span>
            {' · '}{report.durationMs}ms{' · '}Node {report.nodeVersion}
          </div>

          {/* Score arcs + stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted mb-4">Health Scores</p>
              <div className="flex gap-2">
                <ArcGauge score={report.healthScore} label="Health" />
                <ArcGauge score={report.securityScore} label="Security" />
                <ArcGauge score={report.technicalDebtScore} label="Tech Debt" />
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted mb-4">Package Summary</p>
              <div className="grid grid-cols-3 gap-2.5">
                <StatTile label="Total" value={report.totalPackages} tone="neutral" />
                <StatTile label="Outdated" value={report.outdatedPackages} tone={report.outdatedPackages > 0 ? 'warn' : 'good'} />
                <StatTile label="Security" value={report.securityAdvisoryCount} tone={report.securityAdvisoryCount > 0 ? 'danger' : 'good'} />
                <StatTile label="Safe Updates" value={report.safeUpdates} tone={report.safeUpdates > 0 ? 'info' : 'good'} />
                <StatTile label="Deprecated" value={report.deprecatedPackages} tone={report.deprecatedPackages > 0 ? 'warn' : 'good'} />
                <StatTile label="Breaking" value={report.breakingUpdates} tone={report.breakingUpdates > 0 ? 'danger' : 'good'} />
              </div>
            </div>
          </div>

          {/* Feature 7: Auto-update schedule card */}
          <AutoUpdateCard
            enabled={autoUpdateEnabled}
            onToggle={() => {
              setAutoUpdateEnabled(prev => !prev);
              showToast(
                autoUpdateEnabled ? 'Auto-update disabled' : 'Auto-update enabled — safe patches will be applied weekly on Sunday at 2:00 AM',
                autoUpdateEnabled ? 'info' : 'success'
              );
            }}
          />

          {/* ── Action toolbar ──────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={installState === 'loading' || (safeCount === 0 && selectedPackages.size === 0)}
                onClick={() => { void handleInstall(); }}
                className="inline-flex items-center gap-2 rounded-xl border border-success/30 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-success hover:bg-emerald-50 hover:border-success/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {installState === 'loading'
                  ? <><RefreshCw className="h-4 w-4 animate-spin" /> Installing…</>
                  : <><ArrowUpCircle className="h-4 w-4" /> Install Safe Updates
                  {selectedPackages.size > 0 && (
                    <span className="rounded-full bg-success/20 border border-success/30 px-2 py-0.5 text-xs font-bold">{selectedPackages.size}</span>
                  )}
                  </>
                }
              </button>

              {safeCount > 0 && (
                <button
                  type="button"
                  onClick={handleCopyInstall}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-secondary hover:bg-surface-hover hover:border-border-strong transition-all"
                >
                  {copied
                    ? <><ClipboardCheck className="h-4 w-4 text-success" /> Copied!</>
                    : <><ClipboardCopy className="h-4 w-4" /> Copy Install Command</>
                  }
                </button>
              )}

              <button type="button" onClick={() => { void handleReport(); }}
                disabled={reportState === 'loading'}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-secondary hover:bg-surface-hover hover:border-border-strong disabled:opacity-40 transition-all">
                {reportState === 'loading' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {reportState === 'loading' ? 'Generating…' : 'Download Report'}
              </button>
            </div>

            {/* Install result */}
            {installResult && installResult.updated.length > 0 && (
              <div className="rounded-xl border border-success/20 bg-emerald-50 p-4 space-y-2">
                <p className="text-sm font-bold text-success flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {installResult.updated.length} package(s) committed — Vercel is redeploying
                  {installResult.commitSha && <code className="font-mono text-xs ml-1">({installResult.commitSha})</code>}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {installResult.updated.map(pkg => (
                    <span key={pkg} className="rounded-full border border-success/20 bg-emerald-50 px-2.5 py-0.5 text-xs font-mono font-medium text-success">
                      {pkg}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Tabs ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {tabs.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-bold transition-all ${
                      isActive
                        ? tabActiveStyle[tab.color]
                        : 'text-muted hover:text-secondary hover:bg-surface-hover'
                    }`}>
                    {tab.id === 'mint-critical' && <Flame className="h-3.5 w-3.5" />}
                    {tab.label}
                    {tab.count > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        isActive ? tabCountStyle[tab.color] : 'bg-surface-hover text-muted'
                      }`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeTab === 'modernization' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {report.modernizationOpportunities.length === 0 ? (
                  <div className="col-span-2 rounded-xl border border-dashed border-border py-12 text-center">
                    <Zap className="h-7 w-7 text-primary mx-auto mb-2" />
                    <p className="text-sm text-muted">No modernization issues detected.</p>
                  </div>
                ) : (
                  report.modernizationOpportunities.map(opp => (
                    <ModernizationCard key={`${opp.package}-${opp.type}`} opp={opp} />
                  ))
                )}
              </div>
            ) : (
              <PackageTable packages={filteredPackages} selectedPackages={selectedPackages}
                onToggle={togglePackage} showSelect={activeTab === 'safe' || activeTab === 'all'} />
            )}

            {(activeTab === 'safe' || activeTab === 'all') && safeCount > 0 && (
              <p className="text-xs text-muted flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                Select packages to copy a subset, or click <strong className="text-success">Copy Install Command</strong> to copy all {safeCount} patch update(s).
              </p>
            )}
            {activeTab === 'mint-critical' && (
              <p className="text-xs text-muted flex items-center gap-1.5">
                <Flame className="h-3.5 w-3.5 text-primary" />
                Packages directly used in the mint execution pipeline. Breaking updates here can halt all minting operations.
              </p>
            )}
          </div>
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </section>
  );
}

export default DependencyUpdateCenter;
