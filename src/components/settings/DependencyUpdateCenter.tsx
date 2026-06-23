'use client';

import React, { useState, useCallback } from 'react';
import {
  ArrowUpCircle, CheckCircle2, ChevronDown, ChevronUp,
  ClipboardCheck, ClipboardCopy, Download, Package, RefreshCw, ShieldAlert, XCircle, Zap,
} from 'lucide-react';
import type {
  DependencyAuditReport,
  PackageAuditResult,
  ModernizationOpportunity,
  SecuritySeverity,
  UpdateClassification,
} from '@/lib/services/dependency-audit.service';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'safe' | 'minor' | 'breaking' | 'security' | 'modernization' | 'all';
type ActionState = 'idle' | 'loading' | 'success' | 'error';

interface InstallResult {
  updated: string[];
  commitSha?: string;
  message?: string;
}

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, label }: { score: number; label: string }) {
  const size = 88;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444';
  const bg = score >= 80
    ? 'bg-green-500/10 border-green-500/20'
    : score >= 60
    ? 'bg-yellow-500/10 border-yellow-500/20'
    : 'bg-red-500/10 border-red-500/20';

  return (
    <div className={`flex flex-col items-center gap-2 rounded-2xl border px-6 py-4 ${bg}`}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={6}
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
          style={{
            transform: 'rotate(90deg)',
            transformOrigin: `${size / 2}px ${size / 2}px`,
            fontSize: 22, fontWeight: 800, fill: color,
          }}>
          {score}
        </text>
      </svg>
      <span className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400 uppercase">{label}</span>
    </div>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'good' | 'warn' | 'danger' | 'info' }) {
  const styles = {
    neutral: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
    good:    'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300',
    warn:    'bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300',
    danger:  'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300',
    info:    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
  }[tone];
  return (
    <div className={`rounded-xl px-4 py-3 ${styles}`}>
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="text-xs font-medium mt-0.5 opacity-75">{label}</div>
    </div>
  );
}

// ─── Classification badge ──────────────────────────────────────────────────────

function ClassBadge({ classification }: { classification: UpdateClassification }) {
  if (classification === 'SAFE') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/50 px-2.5 py-0.5 text-xs font-bold text-green-700 dark:text-green-300">
      ✓ Safe
    </span>
  );
  if (classification === 'MINOR_REVIEW') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 dark:bg-yellow-900/50 px-2.5 py-0.5 text-xs font-bold text-yellow-700 dark:text-yellow-300">
      ~ Review
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/50 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:text-red-300">
      ✕ Breaking
    </span>
  );
}

// ─── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: SecuritySeverity }) {
  const map: Record<SecuritySeverity, string> = {
    CRITICAL: 'bg-red-600 text-white',
    HIGH: 'bg-orange-500 text-white',
    MEDIUM: 'bg-yellow-400 text-yellow-900',
    LOW: 'bg-gray-400 text-white',
  };
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${map[severity]}`}>
      {severity}
    </span>
  );
}

// ─── Package row ──────────────────────────────────────────────────────────────

function PackageRow({ pkg, selected, onToggle, showSelect }: {
  pkg: PackageAuditResult; selected: boolean; onToggle: () => void; showSelect: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = pkg.securityAdvisories.length > 0 || !!pkg.deprecationMessage;

  return (
    <>
      <tr className={`border-b border-gray-100 dark:border-gray-800 transition-colors
        hover:bg-gray-50/80 dark:hover:bg-gray-800/60
        ${pkg.securityRisk ? 'bg-red-50/20 dark:bg-red-950/10' : ''}
      `}>
        {showSelect && (
          <td className="pl-4 py-3 w-10">
            {pkg.updateType !== 'current' && (
              <input type="checkbox" checked={selected} onChange={onToggle}
                className="h-4 w-4 rounded border-gray-300 accent-indigo-600"
                aria-label={`Select ${pkg.name}`} />
            )}
          </td>
        )}
        <td className="px-4 py-3 max-w-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">{pkg.name}</code>
            {pkg.isDev && <span className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">dev</span>}
            {pkg.deprecated && <span className="rounded bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:text-orange-300">deprecated</span>}
            {pkg.isAbandoned && <span className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">abandoned</span>}
          </div>
          {pkg.updateType !== 'current' && (
            <div className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500 font-mono">
              {pkg.currentVersion} → {pkg.latestVersion}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-400 w-28">{pkg.currentVersion}</td>
        <td className="px-4 py-3 w-28">
          <span className={`text-sm font-mono ${pkg.updateType === 'current' ? 'text-gray-400 dark:text-gray-600' : 'font-bold text-gray-900 dark:text-gray-100'}`}>
            {pkg.latestVersion}
          </span>
        </td>
        <td className="px-4 py-3 w-32">
          {pkg.updateType === 'current' ? <span className="text-xs text-gray-300 dark:text-gray-600">—</span> : <ClassBadge classification={pkg.classification} />}
        </td>
        <td className="px-4 py-3 w-28">
          {pkg.securitySeverity ? <SeverityBadge severity={pkg.securitySeverity} /> : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}
        </td>
        <td className="px-4 py-3 w-20 text-right pr-4">
          {hasDetails && (
            <button type="button" onClick={() => setExpanded(e => !e)}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 font-medium">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded ? 'Hide' : 'Details'}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/80 dark:bg-gray-800/50">
          <td colSpan={showSelect ? 7 : 6} className="px-6 pb-4 pt-2">
            <div className="space-y-2 text-sm">
              {pkg.deprecationMessage && (
                <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 px-3 py-2 text-sm">
                  <span className="font-semibold text-orange-700 dark:text-orange-300">Deprecated: </span>
                  <span className="text-orange-600 dark:text-orange-400">{pkg.deprecationMessage}</span>
                </div>
              )}
              {pkg.securityAdvisories.map(adv => (
                <div key={adv.id} className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <SeverityBadge severity={adv.severity} />
                    <span className="font-semibold text-red-700 dark:text-red-300 text-sm">{adv.title}</span>
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
                    <div>Affected: <code className="font-mono">{adv.affectedVersions}</code></div>
                    <div>Patched: <code className="font-mono">{adv.patchedVersions}</code></div>
                    {adv.cve && <div>CVE: {adv.cve}</div>}
                    <a href={adv.url} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">View Advisory →</a>
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">{pkg.recommendation}</p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Package table ────────────────────────────────────────────────────────────

function PackageTable({ packages, selectedPackages, onToggle, showSelect }: {
  packages: PackageAuditResult[]; selectedPackages: Set<string>;
  onToggle: (name: string) => void; showSelect: boolean;
}) {
  if (packages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-12 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">All clear — no packages in this category.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/80 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          <tr>
            {showSelect && <th className="pl-4 py-3 w-10" />}
            <th className="px-4 py-3 text-left">Package</th>
            <th className="px-4 py-3 text-left w-28">Current</th>
            <th className="px-4 py-3 text-left w-28">Latest</th>
            <th className="px-4 py-3 text-left w-32">Classification</th>
            <th className="px-4 py-3 text-left w-28">Security</th>
            <th className="px-4 py-3 w-20" />
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

// ─── Modernization card ───────────────────────────────────────────────────────

function ModernizationCard({ opp }: { opp: ModernizationOpportunity }) {
  const resolved = opp.status === 'resolved';
  const effortStyle = resolved
    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
    : { low: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300', medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300', high: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' }[opp.effort];
  const typeIcon = { 'deprecated-api': '⚠️', 'better-alternative': '💡', 'performance': '⚡', 'security-hardening': '🔒' }[opp.type];
  return (
    <div className={`rounded-xl border p-4 space-y-2.5 ${resolved ? 'border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {resolved
            ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            : <span>{typeIcon}</span>
          }
          <code className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">{opp.package}</code>
        </div>
        {resolved
          ? <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">✓ Resolved</span>
          : <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize shrink-0 ${effortStyle}`}>{opp.effort} effort</span>
        }
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">{opp.description}</p>
      <div className={`rounded-lg px-3 py-2 border ${resolved ? 'bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900' : 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-800'}`}>
        <p className={`text-xs font-semibold mb-0.5 ${resolved ? 'text-green-700 dark:text-green-300' : 'text-indigo-700 dark:text-indigo-300'}`}>{resolved ? 'Status' : 'Recommendation'}</p>
        <p className={`text-xs ${resolved ? 'text-green-600 dark:text-green-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{opp.recommendation}</p>
      </div>
      {opp.docsUrl && (
        <a href={opp.docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
          View Documentation →
        </a>
      )}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'info'; onClose: () => void }) {
  const styles = {
    success: 'bg-gray-900 dark:bg-gray-800 border-green-500/40 text-white',
    error: 'bg-gray-900 dark:bg-gray-800 border-red-500/40 text-white',
    info: 'bg-gray-900 dark:bg-gray-800 border-blue-500/40 text-white',
  }[type];
  const dot = { success: 'bg-green-400', error: 'bg-red-400', info: 'bg-blue-400' }[type];
  return (
    <div className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-2xl shadow-black/20 ${styles}`}>
      <div className="flex items-center gap-3">
        <div className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-sm flex-1">{message}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none ml-2">×</button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DependencyUpdateCenter() {
  const [report, setReport] = useState<DependencyAuditReport | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('safe');
  const [selectedPackages, setSelectedPackages] = useState<Set<string>>(new Set());

  const [checkState, setCheckState] = useState<ActionState>('idle');
  const [installState, setInstallState] = useState<ActionState>('idle');
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number; packageName: string } | null>(null);
  const [reportState, setReportState] = useState<ActionState>('idle');
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }, []);

  // ── Scan (SSE streaming) ─────────────────────────────────────────────────────
  const handleCheck = useCallback(async () => {
    setCheckState('loading'); setError(null); setScanProgress(null);

    const url = '/api/system/dependency-audit/stream?force=true';

    return new Promise<void>((resolve) => {
      const evtSource = new EventSource(url);

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
        showToast(
          `Scan complete — ${data.report.totalPackages} packages checked in ${data.report.durationMs}ms`,
          'success',
        );
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

  // ── Download Report ───────────────────────────────────────────────────────────
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

  // ── Install Safe Updates → commits package.json to GitHub → Vercel redeploys ──
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

  // ── Copy install command ──────────────────────────────────────────────────────
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

  // ── Toggle package selection ──────────────────────────────────────────────────
  const togglePackage = useCallback((name: string) => {
    setSelectedPackages(prev => {
      const n = new Set(prev);
      if (n.has(name)) { n.delete(name); } else { n.add(name); }
      return n;
    });
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────────
  const filteredPackages = report?.packages.filter(p => {
    if (activeTab === 'all') return true;
    if (activeTab === 'safe') return p.classification === 'SAFE' && p.updateType !== 'current';
    if (activeTab === 'minor') return p.classification === 'MINOR_REVIEW';
    if (activeTab === 'breaking') return p.classification === 'BREAKING';
    if (activeTab === 'security') return p.securityRisk;
    return true;
  }) ?? [];

  const safeCount = report?.safeUpdates ?? 0;
  const minorCount = report?.minorReviewUpdates ?? 0;
  const breakingCount = report?.breakingUpdates ?? 0;
  const securityCount = report?.packages.filter(p => p.securityRisk).length ?? 0;
  const modernCount = report?.modernizationOpportunities.filter(o => o.status !== 'resolved').length ?? 0;
  const isScanning = checkState === 'loading';

  const tabs: { id: Tab; label: string; count: number; color: string }[] = [
    { id: 'safe',          label: 'Safe',         count: safeCount,             color: 'green'  },
    { id: 'minor',         label: 'Review',        count: minorCount,            color: 'yellow' },
    { id: 'breaking',      label: 'Breaking',      count: breakingCount,         color: 'red'    },
    { id: 'security',      label: 'Security',      count: securityCount,         color: 'red'    },
    { id: 'modernization', label: 'Modernization', count: modernCount,           color: 'indigo' },
    { id: 'all',           label: 'All',           count: report?.totalPackages ?? 0, color: 'gray' },
  ];

  const tabActiveStyle: Record<string, string> = {
    green:  'bg-green-500/10 text-green-700 dark:text-green-300 ring-1 ring-green-500/30',
    yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 ring-1 ring-yellow-500/30',
    red:    'bg-red-500/10 text-red-700 dark:text-red-300 ring-1 ring-red-500/30',
    indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500/30',
    gray:   'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  };

  const tabCountStyle: Record<string, string> = {
    green:  'bg-green-500/20 text-green-700 dark:text-green-300',
    yellow: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
    red:    'bg-red-500/20 text-red-700 dark:text-red-300',
    indigo: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
    gray:   'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300',
  };

  return (
    <section className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-indigo-500" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50">Dependency Update Center</h2>
            {report && (
              <span className="rounded-full bg-green-100 dark:bg-green-900/40 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-300">
                Scanned
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xl">
            Keep your app healthy and up to date. Scan your packages to find available updates, security issues, and outdated dependencies.
          </p>

        </div>

        <button
          type="button"
          onClick={() => { void handleCheck(); }}
          disabled={isScanning}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all"
        >
          <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
          {isScanning ? 'Scanning…' : 'Check for Updates'}
        </button>
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {error && !report && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3">
          <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Scan failed</p>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {!report && !isScanning && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 py-20 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 mb-4">
            <Package className="h-8 w-8 text-indigo-400" />
          </div>
          <h3 className="text-base font-semibold text-gray-700 dark:text-gray-300 mb-1">No audit data yet</h3>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
            Click <strong>Scan Now</strong> to check all npm dependencies against the registry.
          </p>
          <button onClick={() => { void handleCheck(); }}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-all">
            <RefreshCw className="h-4 w-4" /> Scan Now
          </button>
        </div>
      )}

      {/* ── Loading state with progress bar ───────────────────────────────── */}
      {isScanning && !report && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-14 px-8 text-center space-y-5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/40">
            <RefreshCw className="h-8 w-8 text-indigo-400 animate-spin" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              {scanProgress ? `Auditing ${scanProgress.packageName || '…'}` : 'Connecting to npm registry…'}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {scanProgress
                ? `${scanProgress.processed} / ${scanProgress.total} packages checked`
                : 'Fetching metadata for all packages. This usually takes 5–15 seconds.'}
            </p>
          </div>
          {scanProgress && scanProgress.total > 0 && (
            <div className="mx-auto max-w-sm space-y-1.5">
              <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${Math.round((scanProgress.processed / scanProgress.total) * 100)}%` }}
                />
              </div>
              <p className="text-right text-xs font-mono text-gray-400 dark:text-gray-500">
                {Math.round((scanProgress.processed / scanProgress.total) * 100)}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Report dashboard ───────────────────────────────────────────────── */}
      {report && (
        <>
          {/* Meta row */}
          <div className="text-xs text-gray-400 dark:text-gray-500">
            Last scanned: <span className="font-medium text-gray-600 dark:text-gray-300">{new Date(report.auditedAt).toLocaleString()}</span>
            {' · '}{report.durationMs}ms{' · '}Node {report.nodeVersion}
          </div>

          {/* Score rings + stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">Health Scores</p>
              <div className="flex gap-4 justify-around">
                <ScoreRing score={report.healthScore} label="Health" />
                <ScoreRing score={report.securityScore} label="Security" />
                <ScoreRing score={report.technicalDebtScore} label="Tech Debt" />
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">Package Summary</p>
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

          {/* ── Action toolbar ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2.5">
              {/* Install Safe Updates — commits package.json to GitHub → Vercel auto-redeploys */}
              <button
                type="button"
                disabled={installState === 'loading' || (safeCount === 0 && selectedPackages.size === 0)}
                onClick={() => { void handleInstall(); }}
                className="inline-flex items-center gap-2 rounded-xl border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-4 py-2.5 text-sm font-semibold text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-950/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {installState === 'loading'
                  ? <><RefreshCw className="h-4 w-4 animate-spin" /> Installing…</>
                  : <><ArrowUpCircle className="h-4 w-4" /> Install Safe Updates
                      {selectedPackages.size > 0 && (
                        <span className="rounded-full bg-green-600 text-white px-2 py-0.5 text-xs font-bold">{selectedPackages.size}</span>
                      )}
                    </>
                }
              </button>

              {/* Copy Install Command */}
              {safeCount > 0 && (
                <button
                  type="button"
                  onClick={handleCopyInstall}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                >
                  {copied
                    ? <><ClipboardCheck className="h-4 w-4 text-green-500" /> Copied!</>
                    : <><ClipboardCopy className="h-4 w-4" /> Copy Install Command</>
                  }
                </button>
              )}

              {/* Download Report */}
              <button type="button" onClick={() => { void handleReport(); }}
                disabled={reportState === 'loading'}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-all">
                {reportState === 'loading' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {reportState === 'loading' ? 'Generating…' : 'Download Report'}
              </button>
            </div>

            {/* Install result */}
            {installResult && installResult.updated.length > 0 && (
              <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-4 space-y-2">
                <p className="text-sm font-semibold text-green-800 dark:text-green-200 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {installResult.updated.length} package(s) committed — Vercel is redeploying
                  {installResult.commitSha && <code className="font-mono text-xs ml-1">({installResult.commitSha})</code>}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {installResult.updated.map(pkg => (
                    <span key={pkg} className="rounded-full bg-green-100 dark:bg-green-900/40 px-2.5 py-0.5 text-xs font-mono font-medium text-green-700 dark:text-green-300">
                      {pkg}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Tabs ──────────────────────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {tabs.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${
                      isActive
                        ? tabActiveStyle[tab.color]
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}>
                    {tab.label}
                    {tab.count > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        isActive ? tabCountStyle[tab.color] : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
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
                  <div className="col-span-2 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-12 text-center">
                    <Zap className="h-7 w-7 text-indigo-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No modernization issues detected.</p>
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
              <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                Select packages to copy a subset, or click <strong>Copy Install Command</strong> to copy all {safeCount} patch update(s).
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
