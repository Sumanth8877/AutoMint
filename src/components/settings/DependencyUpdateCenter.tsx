'use client';

/**
 * DependencyUpdateCenter.tsx
 *
 * Settings → System Maintenance → Dependency Update Center
 *
 * Displays:
 *   - Health / Security / Technical Debt scores
 *   - Package tables grouped by classification
 *   - Security advisory highlights
 *   - Modernization opportunities
 *
 * Actions:
 *   - Check for Updates (READ-ONLY scan)
 *   - Install Safe Updates (patch-only)
 *   - Generate Upgrade Report (Markdown download)
 *   - Create Upgrade Branch (git)
 *
 * Never calls npm install by itself — the user must explicitly
 * click "Install Safe Updates".
 */

import React, { useState, useCallback, useTransition } from 'react';
import type {
  DependencyAuditReport,
  PackageAuditResult,
  ModernizationOpportunity,
  SecuritySeverity,
  UpdateClassification,
} from '@/lib/services/dependency-audit.service';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'safe' | 'minor' | 'breaking' | 'security' | 'modernization' | 'all';

type ActionState = 'idle' | 'loading' | 'success' | 'error';

interface InstallResult {
  updated: Array<{ name: string; from: string; to: string }>;
  skipped: Array<{ name: string; reason: string }>;
  failed: Array<{ name: string; error: string }>;
}

interface BranchResult {
  branchName: string | null;
  packagesUpdated: Array<{ name: string; from: string; to: string }>;
  breakingChangesDetected: Array<{ name: string; currentVersion: string; latestVersion: string }>;
  commitHash?: string;
}

// ─── Score ring ──────────────────────────────────────────────────────────────

function ScoreRing({ score, label, size = 80 }: { score: number; label: string; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;

  const color =
    score >= 80 ? '#22c55e' // green-500
    : score >= 60 ? '#eab308' // yellow-500
    : '#ef4444'; // red-500

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-gray-200 dark:text-gray-700"
          strokeWidth={6}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="rotate-90"
          style={{
            transform: `rotate(90deg) translate(0px, 0px)`,
            transformOrigin: `${size / 2}px ${size / 2}px`,
            fontSize: size >= 80 ? 18 : 14,
            fontWeight: 700,
            fill: color,
          }}
        >
          {score}
        </text>
      </svg>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: 'green' | 'yellow' | 'red' | 'gray' | 'blue';
  icon: string;
}) {
  const colorMap = {
    green: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
    yellow: 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300',
    red: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
    gray: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300',
    blue: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colorMap[color]}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs font-medium opacity-80">{label}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Classification badge ────────────────────────────────────────────────────

function ClassBadge({ classification }: { classification: UpdateClassification }) {
  if (classification === 'SAFE') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-xs font-semibold text-green-700 dark:text-green-300">
        ✅ Safe
      </span>
    );
  }
  if (classification === 'MINOR_REVIEW') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 dark:bg-yellow-900/40 px-2 py-0.5 text-xs font-semibold text-yellow-700 dark:text-yellow-300">
        🔍 Review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300">
      💥 Breaking
    </span>
  );
}

// ─── Severity badge ──────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: SecuritySeverity }) {
  const map: Record<SecuritySeverity, string> = {
    CRITICAL: 'bg-red-600 text-white',
    HIGH: 'bg-orange-500 text-white',
    MEDIUM: 'bg-yellow-500 text-black',
    LOW: 'bg-gray-400 text-white',
  };
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-bold ${map[severity]}`}>
      {severity}
    </span>
  );
}

// ─── Package row ─────────────────────────────────────────────────────────────

function PackageRow({
  pkg,
  selected,
  onToggle,
  showSelect,
}: {
  pkg: PackageAuditResult;
  selected: boolean;
  onToggle: () => void;
  showSelect: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAdvisories = pkg.securityAdvisories.length > 0;

  return (
    <>
      <tr
        className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
          hasAdvisories ? 'bg-red-50/30 dark:bg-red-950/10' : ''
        }`}
      >
        {showSelect && (
          <td className="px-4 py-3">
            {pkg.updateType !== 'current' && (
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggle}
                className="h-4 w-4 rounded border-gray-300 accent-indigo-600"
                aria-label={`Select ${pkg.name}`}
              />
            )}
          </td>
        )}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
              {pkg.name}
            </span>
            {pkg.isDev && (
              <span className="rounded bg-gray-100 dark:bg-gray-700 px-1 py-0.5 text-xs text-gray-500 dark:text-gray-400">
                dev
              </span>
            )}
            {pkg.deprecated && (
              <span className="rounded bg-orange-100 dark:bg-orange-900/40 px-1 py-0.5 text-xs text-orange-700 dark:text-orange-300">
                deprecated
              </span>
            )}
            {pkg.isAbandoned && (
              <span className="rounded bg-gray-100 dark:bg-gray-700 px-1 py-0.5 text-xs text-gray-500 dark:text-gray-400">
                abandoned
              </span>
            )}
          </div>
          {pkg.updateType !== 'current' && (
            <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              {pkg.currentVersion} → {pkg.latestVersion}
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          <span className="font-mono text-sm text-gray-600 dark:text-gray-400">
            {pkg.currentVersion}
          </span>
        </td>
        <td className="px-4 py-3">
          <span
            className={`font-mono text-sm ${
              pkg.updateType === 'current'
                ? 'text-gray-400 dark:text-gray-600'
                : 'text-gray-900 dark:text-gray-100 font-semibold'
            }`}
          >
            {pkg.latestVersion}
          </span>
        </td>
        <td className="px-4 py-3">
          {pkg.updateType === 'current' ? (
            <span className="text-xs text-gray-400 dark:text-gray-600">—</span>
          ) : (
            <ClassBadge classification={pkg.classification} />
          )}
        </td>
        <td className="px-4 py-3">
          {pkg.securitySeverity ? (
            <SeverityBadge severity={pkg.securitySeverity} />
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-600">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {(hasAdvisories || pkg.deprecationMessage) && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {expanded ? 'Hide' : 'Details'}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-gray-800/70">
          <td colSpan={showSelect ? 7 : 6} className="px-6 pb-4 pt-2">
            <div className="space-y-2 text-sm">
              {pkg.deprecationMessage && (
                <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 px-3 py-2">
                  <span className="font-semibold text-orange-700 dark:text-orange-300">Deprecated: </span>
                  <span className="text-orange-700 dark:text-orange-300">{pkg.deprecationMessage}</span>
                </div>
              )}
              {pkg.securityAdvisories.map((adv) => (
                <div
                  key={adv.id}
                  className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-3 py-2"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <SeverityBadge severity={adv.severity} />
                    <span className="font-semibold text-red-700 dark:text-red-300">{adv.title}</span>
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
                    <div>Affected: <code className="font-mono">{adv.affectedVersions}</code></div>
                    <div>Patched: <code className="font-mono">{adv.patchedVersions}</code></div>
                    {adv.cve && <div>CVE: {adv.cve}</div>}
                    <a href={adv.url} target="_blank" rel="noopener noreferrer" className="underline">
                      View Advisory →
                    </a>
                  </div>
                </div>
              ))}
              <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                {pkg.recommendation}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Package table ────────────────────────────────────────────────────────────

function PackageTable({
  packages,
  selectedPackages,
  onToggle,
  showSelect,
}: {
  packages: PackageAuditResult[];
  selectedPackages: Set<string>;
  onToggle: (name: string) => void;
  showSelect: boolean;
}) {
  if (packages.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 py-12 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No packages in this category.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          <tr>
            {showSelect && <th className="px-4 py-3 w-10" />}
            <th className="px-4 py-3 text-left">Package</th>
            <th className="px-4 py-3 text-left">Current</th>
            <th className="px-4 py-3 text-left">Latest</th>
            <th className="px-4 py-3 text-left">Classification</th>
            <th className="px-4 py-3 text-left">Security</th>
            <th className="px-4 py-3 w-16" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {packages.map((pkg) => (
            <PackageRow
              key={pkg.name}
              pkg={pkg}
              selected={selectedPackages.has(pkg.name)}
              onToggle={() => onToggle(pkg.name)}
              showSelect={showSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Modernization card ───────────────────────────────────────────────────────

function ModernizationCard({ opp }: { opp: ModernizationOpportunity }) {
  const effortColor = {
    low: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  }[opp.effort];

  const typeIcon: Record<ModernizationOpportunity['type'], string> = {
    'deprecated-api': '⚠️',
    'better-alternative': '💡',
    'performance': '⚡',
    'security-hardening': '🔒',
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>{typeIcon[opp.type]}</span>
          <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
            {opp.package}
          </span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${effortColor}`}>
          {opp.effort} effort
        </span>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">{opp.description}</p>
      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-800 px-3 py-2">
        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-0.5">
          Recommendation
        </p>
        <p className="text-xs text-indigo-600 dark:text-indigo-400">{opp.recommendation}</p>
      </div>
      {opp.docsUrl && (
        <a
          href={opp.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          View Documentation →
        </a>
      )}
    </div>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionButton({
  children,
  onClick,
  state,
  variant = 'primary',
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  state: ActionState;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const isLoading = state === 'loading';
  const isDisabled = disabled || isLoading;

  const base = 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const variantStyle = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500',
    secondary: 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 focus:ring-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`${base} ${variantStyle}`}
    >
      {isLoading && (
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

// ─── Toast notification ───────────────────────────────────────────────────────

function Toast({
  message,
  type,
  onClose,
}: {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}) {
  const style = {
    success: 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700 text-green-800 dark:text-green-200',
    error: 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200',
    info: 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200',
  }[type];

  return (
    <div className={`fixed bottom-6 right-6 z-50 rounded-xl border px-4 py-3 shadow-lg max-w-sm ${style}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-sm flex-1">{message}</span>
        <button onClick={onClose} className="text-current opacity-60 hover:opacity-100 text-lg leading-none">
          ×
        </button>
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
  const [reportState, setReportState] = useState<ActionState>('idle');
  const [branchState, setBranchState] = useState<ActionState>('idle');

  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [branchResult, setBranchResult] = useState<BranchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [, startTransition] = useTransition();

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info') => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 6000);
    },
    [],
  );

  // ── Check for Updates ──────────────────────────────────────────────────────
  const handleCheck = useCallback(async () => {
    setCheckState('loading');
    setError(null);
    setInstallResult(null);
    setBranchResult(null);

    try {
      const res = await fetch('/api/system/dependency-audit');
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      const data = await res.json() as { report: DependencyAuditReport };
      setReport(data.report);
      setCheckState('success');
      setActiveTab('safe');
      setSelectedPackages(new Set());
      showToast(
        `Audit complete — ${data.report.totalPackages} packages checked in ${data.report.durationMs}ms`,
        'success',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Audit failed';
      setError(msg);
      setCheckState('error');
      showToast(msg, 'error');
    }
  }, [showToast]);

  // ── Install Safe Updates ───────────────────────────────────────────────────
  const handleInstall = useCallback(async () => {
    if (!report) return;
    const pkgNames = selectedPackages.size > 0 ? Array.from(selectedPackages) : undefined;
    setInstallState('loading');

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
      showToast(
        `Updated ${data.updated.length} package(s). ${data.failed.length} failed.`,
        data.failed.length > 0 ? 'error' : 'success',
      );

      // Re-scan after successful install
      startTransition(() => { void handleCheck(); });
    } catch (err) {
      setInstallState('error');
      showToast(err instanceof Error ? err.message : 'Install failed', 'error');
    }
  }, [report, selectedPackages, handleCheck, showToast, startTransition]);

  // ── Generate Report ────────────────────────────────────────────────────────
  const handleReport = useCallback(async () => {
    setReportState('loading');
    try {
      const res = await fetch('/api/system/upgrade-report?format=markdown');
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Report generation failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `automint-upgrade-report-${new Date().toISOString().split('T')[0]}.md`;
      a.click();
      URL.revokeObjectURL(url);
      setReportState('success');
      showToast('Upgrade report downloaded.', 'success');
    } catch (err) {
      setReportState('error');
      showToast(err instanceof Error ? err.message : 'Report failed', 'error');
    }
  }, [showToast]);

  // ── Create Upgrade Branch ─────────────────────────────────────────────────
  const handleBranch = useCallback(async () => {
    setBranchState('loading');
    setBranchResult(null);
    try {
      const res = await fetch('/api/system/upgrade-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json() as BranchResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Branch creation failed');

      setBranchResult(data);
      setBranchState('success');
      showToast(
        data.branchName
          ? `Branch \`${data.branchName}\` created with ${data.packagesUpdated.length} update(s).`
          : 'No packages to update.',
        'success',
      );
    } catch (err) {
      setBranchState('error');
      showToast(err instanceof Error ? err.message : 'Branch creation failed', 'error');
    }
  }, [showToast]);

  // ── Toggle package selection ──────────────────────────────────────────────
  const togglePackage = useCallback((name: string) => {
    setSelectedPackages((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // ── Tab filtering ─────────────────────────────────────────────────────────
  const filteredPackages = report?.packages.filter((p) => {
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
  const securityCount = report?.packages.filter((p) => p.securityRisk).length ?? 0;

  const tabs: { id: Tab; label: string; count: number; activeClass: string }[] = [
    { id: 'safe', label: '✅ Safe', count: safeCount, activeClass: 'border-green-500 text-green-700 dark:text-green-300' },
    { id: 'minor', label: '🔍 Review', count: minorCount, activeClass: 'border-yellow-500 text-yellow-700 dark:text-yellow-300' },
    { id: 'breaking', label: '💥 Breaking', count: breakingCount, activeClass: 'border-red-500 text-red-700 dark:text-red-300' },
    { id: 'security', label: '🚨 Security', count: securityCount, activeClass: 'border-red-600 text-red-700 dark:text-red-300' },
    { id: 'modernization', label: '🔧 Modernization', count: report?.modernizationOpportunities.length ?? 0, activeClass: 'border-indigo-500 text-indigo-700 dark:text-indigo-300' },
    { id: 'all', label: 'All Packages', count: report?.totalPackages ?? 0, activeClass: 'border-gray-500 text-gray-700 dark:text-gray-300' },
  ];

  const hasSafeUpdates = safeCount > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">
          Dependency Update Center
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Audit installed npm packages for outdated versions, security vulnerabilities,
          deprecated packages, and modernization opportunities.
        </p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          ⚠️ <strong>Checking for updates never modifies files.</strong> Only "Install Safe Updates" may change package.json.
        </p>
      </div>

      {/* Last checked + stats bar */}
      {report && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Last checked:{' '}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {new Date(report.auditedAt).toLocaleString()}
              </span>
              {' · '}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {report.durationMs}ms
              </span>
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500">
              Node {report.nodeVersion}
            </div>
          </div>

          {/* Score rings */}
          <div className="flex flex-wrap gap-6 justify-center sm:justify-start mb-5">
            <ScoreRing score={report.healthScore} label="Health" />
            <ScoreRing score={report.securityScore} label="Security" />
            <ScoreRing score={report.technicalDebtScore} label="Tech Debt" />
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard label="Total" value={report.totalPackages} color="gray" icon="📦" />
            <StatCard label="Outdated" value={report.outdatedPackages} color={report.outdatedPackages > 0 ? 'yellow' : 'green'} icon="📈" />
            <StatCard label="Security" value={report.securityAdvisoryCount} color={report.securityAdvisoryCount > 0 ? 'red' : 'green'} icon="🚨" />
            <StatCard label="Deprecated" value={report.deprecatedPackages} color={report.deprecatedPackages > 0 ? 'yellow' : 'green'} icon="⚠️" />
            <StatCard label="Safe Updates" value={report.safeUpdates} color={report.safeUpdates > 0 ? 'blue' : 'green'} icon="✅" />
            <StatCard label="Breaking" value={report.breakingUpdates} color={report.breakingUpdates > 0 ? 'red' : 'green'} icon="💥" />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <ActionButton onClick={handleCheck} state={checkState} variant="primary">
          {checkState === 'loading' ? 'Scanning…' : '🔍 Check for Updates'}
        </ActionButton>

        {report && (
          <>
            <ActionButton
              onClick={handleInstall}
              state={installState}
              variant="secondary"
              disabled={!hasSafeUpdates && selectedPackages.size === 0}
            >
              {installState === 'loading' ? 'Installing…' : '⬆️ Install Safe Updates'}
              {selectedPackages.size > 0 && (
                <span className="rounded-full bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                  {selectedPackages.size}
                </span>
              )}
            </ActionButton>

            <ActionButton onClick={handleReport} state={reportState} variant="secondary">
              {reportState === 'loading' ? 'Generating…' : '📄 Generate Upgrade Report'}
            </ActionButton>

            <ActionButton onClick={handleBranch} state={branchState} variant="secondary">
              {branchState === 'loading' ? 'Creating Branch…' : '🌿 Create Upgrade Branch'}
            </ActionButton>
          </>
        )}
      </div>

      {/* Error banner */}
      {error && !report && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <span className="font-semibold">Error: </span>{error}
        </div>
      )}

      {/* Empty state */}
      {!report && checkState !== 'loading' && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 py-16 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
            No audit data yet
          </h3>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Click "Check for Updates" to scan all npm dependencies.
          </p>
        </div>
      )}

      {/* Loading state */}
      {checkState === 'loading' && !report && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-16 text-center">
          <div className="flex justify-center mb-4">
            <svg className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Scanning npm registry…
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Fetching metadata for all packages. This may take up to 30 seconds.
          </p>
        </div>
      )}

      {/* Install result */}
      {installResult && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Install Results</h3>
          {installResult.updated.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-green-700 dark:text-green-300 uppercase tracking-wide">
                ✅ Updated ({installResult.updated.length})
              </div>
              {installResult.updated.map((u) => (
                <div key={u.name} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <code className="font-mono">{u.name}</code>
                  <span className="text-gray-400">
                    {u.from} → {u.to}
                  </span>
                </div>
              ))}
            </div>
          )}
          {installResult.failed.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">
                ❌ Failed ({installResult.failed.length})
              </div>
              {installResult.failed.map((f) => (
                <div key={f.name} className="text-sm text-red-600 dark:text-red-400">
                  <code className="font-mono">{f.name}</code>: {f.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Branch result */}
      {branchResult && branchResult.branchName && (
        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-4 space-y-2">
          <h3 className="font-semibold text-green-800 dark:text-green-200">
            🌿 Branch Created: <code className="font-mono">{branchResult.branchName}</code>
          </h3>
          {branchResult.commitHash && (
            <p className="text-sm text-green-700 dark:text-green-300">
              Commit: <code className="font-mono">{branchResult.commitHash}</code>
            </p>
          )}
          <p className="text-sm text-green-700 dark:text-green-300">
            {branchResult.packagesUpdated.length} package(s) updated.
            {branchResult.breakingChangesDetected.length > 0 && (
              <span className="ml-1 text-orange-600 dark:text-orange-400">
                {branchResult.breakingChangesDetected.length} breaking change(s) detected — not included.
              </span>
            )}
          </p>
        </div>
      )}

      {/* Main report panel */}
      {report && (
        <div className="space-y-4">
          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="flex flex-wrap gap-0 -mb-px">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? `${tab.activeClass} border-current`
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${
                      activeTab === tab.id
                        ? 'bg-current/10'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab content */}
          {activeTab === 'modernization' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {report.modernizationOpportunities.length === 0 ? (
                <div className="col-span-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No modernization issues detected for installed packages.
                  </p>
                </div>
              ) : (
                report.modernizationOpportunities.map((opp) => (
                  <ModernizationCard key={`${opp.package}-${opp.type}`} opp={opp} />
                ))
              )}
            </div>
          ) : (
            <PackageTable
              packages={filteredPackages}
              selectedPackages={selectedPackages}
              onToggle={togglePackage}
              showSelect={activeTab === 'safe' || activeTab === 'all'}
            />
          )}

          {/* Selection hint */}
          {(activeTab === 'safe' || activeTab === 'all') && safeCount > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              💡 Select packages to install a subset, or click "Install Safe Updates" to install all{' '}
              {safeCount} patch update(s).
            </p>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </section>
  );
}

export default DependencyUpdateCenter;
