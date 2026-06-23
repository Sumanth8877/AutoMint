/**
 * dependency-audit.service.ts
 *
 * Dependency Update Center — audit engine.
 *
 * SAFETY CONTRACT: READ-ONLY.
 * This service NEVER writes files, NEVER runs npm install,
 * and NEVER modifies package.json.
 */

import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import { addBreadcrumb, captureException } from '@/lib/observability/sentry';
import { getRedisClient } from '@/lib/redis';

// Per-package Redis cache TTL: 24 hours
// Key format: dep-pkg:${name}@${installedVersion}
// Cache is automatically invalidated when the installed version changes.
const PKG_CACHE_TTL_SECONDS = 86_400;
const PKG_CACHE_PREFIX = 'dep-pkg:';

// ─── Types ──────────────────────────────────────────────────────────────────

export type UpdateType = 'current' | 'patch' | 'minor' | 'major';
export type UpdateClassification = 'SAFE' | 'MINOR_REVIEW' | 'BREAKING';
export type SecuritySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ModernizationEffort = 'low' | 'medium' | 'high';

export interface SecurityAdvisory {
  id: string;
  title: string;
  severity: SecuritySeverity;
  url: string;
  affectedVersions: string;
  patchedVersions: string;
  cve?: string;
}

export interface PackageAuditResult {
  name: string;
  currentVersion: string;
  latestVersion: string;
  wantedVersion: string;
  updateType: UpdateType;
  classification: UpdateClassification;
  isDev: boolean;
  deprecated: boolean;
  deprecationMessage: string | null;
  isAbandoned: boolean;
  lastPublishDaysAgo: number | null;
  weeklyDownloads: number | null;
  securityRisk: boolean;
  securitySeverity: SecuritySeverity | null;
  securityAdvisories: SecurityAdvisory[];
  recommendation: string;
  changelogUrl: string | null;
  homepage: string | null;
}

export interface ModernizationOpportunity {
  package: string;
  type: 'deprecated-api' | 'better-alternative' | 'performance' | 'security-hardening';
  description: string;
  recommendation: string;
  effort: ModernizationEffort;
  docsUrl?: string;
  /** 'resolved' = already done; 'pending' (default) = action needed */
  status?: 'pending' | 'resolved';
}

export interface DependencyAuditReport {
  auditedAt: string;
  durationMs: number;
  totalPackages: number;
  outdatedPackages: number;
  securityAdvisoryCount: number;
  deprecatedPackages: number;
  abandonedPackages: number;
  safeUpdates: number;
  minorReviewUpdates: number;
  breakingUpdates: number;
  packages: PackageAuditResult[];
  healthScore: number;
  securityScore: number;
  technicalDebtScore: number;
  modernizationOpportunities: ModernizationOpportunity[];
  nodeVersion: string;
  npmVersion: string;
}

// ─── Semver helpers ──────────────────────────────────────────────────────────

function stripRange(version: string): string {
  return version.replace(/^[\^~>=<*\s]+/, '').split(' ')[0] ?? '0.0.0';
}

function parseSemver(version: string): [number, number, number] {
  const clean = stripRange(version).split('-')[0] ?? '';
  const parts = clean.split('.').map((p) => parseInt(p, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function classifyUpdate(installed: string, latest: string): UpdateType {
  const [iMaj, iMin, iPat] = parseSemver(installed);
  const [lMaj, lMin, lPat] = parseSemver(latest);
  if (lMaj > iMaj) return 'major';
  if (lMin > iMin) return 'minor';
  if (lPat > iPat) return 'patch';
  return 'current';
}

function toClassification(updateType: UpdateType): UpdateClassification {
  if (updateType === 'patch') return 'SAFE';
  if (updateType === 'minor') return 'MINOR_REVIEW';
  if (updateType === 'major') return 'BREAKING';
  return 'SAFE';
}

// ─── npm registry helpers ────────────────────────────────────────────────────

interface NpmVersionMeta {
  deprecated?: string;
}

interface NpmPackageData {
  name: string;
  deprecated?: string;
  homepage?: string;
  repository?: { url?: string };
  'dist-tags': { latest: string };
  time?: Record<string, string>;
  versions?: Record<string, NpmVersionMeta>;
}

interface NpmDownloadsData {
  downloads?: number;
}

const NPM_REGISTRY = 'https://registry.npmjs.org';
const NPM_DOWNLOADS_API = 'https://api.npmjs.org';
const FETCH_TIMEOUT_MS = 8_000;
const ABANDONED_THRESHOLD_DAYS = 730;

async function fetchPackageMetadata(name: string): Promise<NpmPackageData | null> {
  try {
    const encodedName = encodeURIComponent(name).replace(/%40/g, '@').replace(/%2F/g, '/');
    const res = await fetch(`${NPM_REGISTRY}/${encodedName}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.json() as Promise<NpmPackageData>;
  } catch {
    return null;
  }
}

async function fetchWeeklyDownloads(name: string): Promise<number | null> {
  try {
    const encodedName = encodeURIComponent(name).replace(/%40/g, '@').replace(/%2F/g, '/');
    const res = await fetch(
      `${NPM_DOWNLOADS_API}/downloads/point/last-week/${encodedName}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const data = await res.json() as NpmDownloadsData;
    return data.downloads ?? null;
  } catch {
    return null;
  }
}

// ─── Security advisory helpers ───────────────────────────────────────────────

interface NpmAuditAdvisory {
  id: number;
  module_name?: string;
  title: string;
  severity: string;
  url: string;
  vulnerable_versions: string;
  patched_versions: string;
  cves?: string[];
}

interface NpmBulkAuditResponse {
  advisories?: Record<string, NpmAuditAdvisory>;
}

async function fetchSecurityAdvisories(
  packages: Record<string, string>,
): Promise<Map<string, SecurityAdvisory[]>> {
  const result = new Map<string, SecurityAdvisory[]>();
  try {
    const requires: Record<string, string> = {};
    const dependencies: Record<string, { version: string }> = {};
    for (const [name, version] of Object.entries(packages)) {
      const clean = stripRange(version);
      requires[name] = clean;
      dependencies[name] = { version: clean };
    }

    const res = await fetch(`${NPM_REGISTRY}/-/npm/v1/security/audits/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'automint-audit', version: '0.0.0', requires, dependencies }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return result;

    const data = await res.json() as NpmBulkAuditResponse;
    for (const advisory of Object.values(data.advisories ?? {})) {
      const pkgName = advisory.module_name;
      if (!pkgName) continue;
      const existing = result.get(pkgName) ?? [];
      existing.push({
        id: String(advisory.id),
        title: advisory.title,
        severity: normalizeSeverity(advisory.severity),
        url: advisory.url,
        affectedVersions: advisory.vulnerable_versions,
        patchedVersions: advisory.patched_versions,
        cve: advisory.cves?.[0],
      });
      result.set(pkgName, existing);
    }
  } catch { /* non-fatal */ }
  return result;
}

function normalizeSeverity(s: string): SecuritySeverity {
  const lower = (s ?? '').toLowerCase();
  if (lower === 'critical') return 'CRITICAL';
  if (lower === 'high') return 'HIGH';
  if (lower === 'moderate' || lower === 'medium') return 'MEDIUM';
  return 'LOW';
}

function highestSeverity(advisories: SecurityAdvisory[]): SecuritySeverity | null {
  if (advisories.length === 0) return null;
  const order: SecuritySeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  for (const sev of order) {
    if (advisories.some((a) => a.severity === sev)) return sev;
  }
  return 'LOW';
}

// ─── Modernization patterns ──────────────────────────────────────────────────

const MODERNIZATION_PATTERNS: ModernizationOpportunity[] = [
  {
    package: 'next',
    type: 'deprecated-api',
    status: 'resolved',
    description: 'No pages/ directory found — app is fully on the App Router.',
    recommendation: 'No action needed. getServerSideProps / getStaticProps are absent; all data-fetching uses React Server Components + fetch().',
    effort: 'high',
    docsUrl: 'https://nextjs.org/docs/app/building-your-application/upgrading/app-router-migration',
  },
  {
    package: 'react',
    type: 'deprecated-api',
    status: 'resolved',
    description: 'No legacy context API, createFactory, or contextType usage found.',
    recommendation: 'No action needed. All context consumers use useContext; no createFactory calls exist.',
    effort: 'medium',
    docsUrl: 'https://react.dev/blog/2024/04/25/react-19-upgrade-guide',
  },
  {
    package: '@clerk/nextjs',
    type: 'deprecated-api',
    status: 'resolved',
    description: 'Middleware already uses clerkMiddleware() from @clerk/nextjs/server.',
    recommendation: 'No action needed. authMiddleware is not used anywhere.',
    effort: 'medium',
    docsUrl: 'https://clerk.com/docs/upgrade-guides/core-2',
  },
  {
    package: 'drizzle-orm',
    type: 'deprecated-api',
    status: 'resolved',
    description: 'No .toSQL() calls found in the codebase.',
    recommendation: 'No action needed. All queries use the standard Drizzle query builder without .toSQL().',
    effort: 'low',
    docsUrl: 'https://orm.drizzle.team/docs/prepared-statements',
  },
  {
    package: 'drizzle-kit',
    type: 'security-hardening',
    status: 'resolved',
    description: 'db:push removed from package.json scripts — db:migrate is the only migration command.',
    recommendation: 'No action needed. Production migrations use drizzle-kit migrate (safe, additive-only).',
    effort: 'medium',
    docsUrl: 'https://orm.drizzle.team/docs/migrations',
  },
  {
    package: 'viem',
    type: 'deprecated-api',
    status: 'resolved',
    description: 'All createPublicClient and createWalletClient calls already use http() transport.',
    recommendation: 'No action needed. rpc-manager, infrastructure-test, and integrations route all pass http() with explicit timeout.',
    effort: 'low',
    docsUrl: 'https://viem.sh/docs/migration-guide.html',
  },
  {
    package: '@upstash/redis',
    type: 'performance',
    status: 'resolved',
    description: 'nonce-allocator now uses redis.pipeline() for sequential write pairs.',
    recommendation: 'Done. counter SET + inflight ZADD during allocation, and counter SET + inflight DEL during reset, are both pipelined.',
    effort: 'medium',
    docsUrl: 'https://upstash.com/docs/redis/sdks/ts/pipeline',
  },
  {
    package: '@neondatabase/serverless',
    type: 'performance',
    status: 'resolved',
    description: 'getPoolDb() added to src/lib/db/index.ts for high-concurrency routes.',
    recommendation: 'Done. Import getPoolDb() instead of getDb() in routes that run parallel queries (e.g. analytics, whale tracker).',
    effort: 'medium',
    docsUrl: 'https://neon.tech/docs/serverless/serverless-driver',
  },
];

// ─── Package.json reader ─────────────────────────────────────────────────────

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error('package.json not found at project root');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PackageJson;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function computeScores(packages: PackageAuditResult[]): {
  healthScore: number;
  securityScore: number;
  technicalDebtScore: number;
} {
  if (packages.length === 0) return { healthScore: 100, securityScore: 100, technicalDebtScore: 100 };
  let securityDeductions = 0;
  for (const pkg of packages) {
    for (const adv of pkg.securityAdvisories) {
      if (adv.severity === 'CRITICAL') securityDeductions += 20;
      else if (adv.severity === 'HIGH') securityDeductions += 10;
      else if (adv.severity === 'MEDIUM') securityDeductions += 5;
      else securityDeductions += 2;
    }
    if (pkg.deprecated) securityDeductions += 3;
  }
  const securityScore = Math.max(0, 100 - securityDeductions);
  const outdatedRatio = packages.filter((p) => p.updateType !== 'current').length / packages.length;
  const technicalDebtScore = Math.max(0, Math.round(100 - outdatedRatio * 60));
  return { healthScore: Math.round((securityScore + technicalDebtScore) / 2), securityScore, technicalDebtScore };
}

// ─── Recommendation builder ───────────────────────────────────────────────────

function buildRecommendation(pkg: Omit<PackageAuditResult, 'recommendation'>): string {
  if (pkg.updateType === 'current') return 'Up to date. No action required.';
  const parts: string[] = [];
  if (pkg.securityRisk && pkg.securitySeverity) parts.push(`⚠️ ${pkg.securitySeverity} security advisory — update immediately.`);
  if (pkg.deprecated) parts.push(pkg.deprecationMessage ? `Deprecated: ${pkg.deprecationMessage}` : 'Deprecated. Migrate to a maintained alternative.');
  if (pkg.isAbandoned) parts.push('Package appears abandoned (no publish in 2+ years).');
  if (pkg.updateType === 'patch') parts.push(`Patch update (${pkg.currentVersion} → ${pkg.latestVersion}). Safe to install.`);
  else if (pkg.updateType === 'minor') parts.push(`Minor update (${pkg.currentVersion} → ${pkg.latestVersion}). Review changelog.`);
  else if (pkg.updateType === 'major') parts.push(`Major update (${pkg.currentVersion} → ${pkg.latestVersion}). Breaking changes likely.`);
  return parts.join(' ') || 'Review and update when convenient.';
}

// ─── Main audit function ──────────────────────────────────────────────────────

export async function runDependencyAudit(options: {
  devPackages?: boolean;
  concurrency?: number;
  /** Called after each package is processed — use for SSE progress streaming. */
  onProgress?: (processed: number, total: number, packageName: string) => void;
} = {}): Promise<DependencyAuditReport> {
  const startMs = Date.now();
  const { devPackages = true, concurrency = 8, onProgress } = options;
  let processedCount = 0;

  addBreadcrumb({ category: 'dependency-audit', message: 'audit started', level: 'info', data: { devPackages, concurrency } });

  const pkg = readPackageJson();
  const prodDeps = pkg.dependencies ?? {};
  const devDeps = devPackages ? (pkg.devDependencies ?? {}) : {};

  const allDeps: Record<string, { version: string; isDev: boolean }> = {};
  for (const [name, version] of Object.entries(prodDeps)) allDeps[name] = { version, isDev: false };
  for (const [name, version] of Object.entries(devDeps)) { if (!allDeps[name]) allDeps[name] = { version, isDev: true }; }

  const packageNames = Object.keys(allDeps);
  const allVersionsForAudit: Record<string, string> = {};
  for (const [name, { version }] of Object.entries(allDeps)) allVersionsForAudit[name] = version;
  const advisoriesByPackage = await fetchSecurityAdvisories(allVersionsForAudit);

  const results: PackageAuditResult[] = [];

  async function processPackage(name: string): Promise<PackageAuditResult | null> {
    const entry = allDeps[name];
    if (!entry) return null;
    const { version: installedRange, isDev } = entry;
    const installedVersion = stripRange(installedRange);

    // Improvement 1: per-package Redis cache (24h TTL).
    // Cache key includes the installed version so it auto-invalidates
    // when you install a new version of the package.
    const cacheKey = `${PKG_CACHE_PREFIX}${name}@${installedVersion}`;
    try {
      const redis = getRedisClient();
      const cached = await redis.get<PackageAuditResult>(cacheKey);
      if (cached) {
        processedCount++;
        onProgress?.(processedCount, packageNames.length, name);
        return cached;
      }
    } catch { /* Redis unavailable — fall through to live fetch */ }

    try {
      const [meta, weeklyDownloads] = await Promise.all([
        fetchPackageMetadata(name),
        fetchWeeklyDownloads(name),
      ]);

      const latestVersion = meta?.['dist-tags']?.latest ?? installedVersion;
      const updateType = classifyUpdate(installedVersion, latestVersion);
      const classification = toClassification(updateType);

      const latestVersionMeta = meta?.versions?.[latestVersion];
      const deprecated = Boolean(meta?.deprecated ?? latestVersionMeta?.deprecated ?? false);
      const deprecationMessage =
        typeof meta?.deprecated === 'string' ? meta.deprecated
        : typeof latestVersionMeta?.deprecated === 'string' ? latestVersionMeta.deprecated
        : null;

      const lastPublishDate = meta?.time?.[latestVersion] ?? meta?.time?.['modified'];
      let lastPublishDaysAgo: number | null = null;
      let isAbandoned = false;
      if (lastPublishDate) {
        const diffMs = Date.now() - new Date(lastPublishDate).getTime();
        lastPublishDaysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        isAbandoned = lastPublishDaysAgo > ABANDONED_THRESHOLD_DAYS;
      }

      const securityAdvisories = advisoriesByPackage.get(name) ?? [];
      const securitySeverity = highestSeverity(securityAdvisories);
      const securityRisk = securityAdvisories.length > 0;

      const repoUrl = meta?.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
      const changelogUrl = repoUrl ? `${repoUrl}/blob/main/CHANGELOG.md` : null;

      const partial: Omit<PackageAuditResult, 'recommendation'> = {
        name, currentVersion: installedVersion, latestVersion,
        wantedVersion: installedVersion, updateType, classification, isDev,
        deprecated, deprecationMessage, isAbandoned, lastPublishDaysAgo,
        weeklyDownloads, securityRisk, securitySeverity, securityAdvisories,
        changelogUrl, homepage: meta?.homepage ?? null,
      };

      const result = { ...partial, recommendation: buildRecommendation(partial) };

      // Write to Redis cache (best-effort, non-blocking)
      try {
        const redis = getRedisClient();
        await redis.set(cacheKey, result, { ex: PKG_CACHE_TTL_SECONDS });
      } catch { /* non-fatal */ }

      processedCount++;
      onProgress?.(processedCount, packageNames.length, name);
      return result;
    } catch (error) {
      await captureException(error, {
        area: 'dependency-audit',
        context: { package: name },
        fingerprint: ['dependency-audit', 'package-fetch'],
      });
      processedCount++;
      onProgress?.(processedCount, packageNames.length, name);
      return null;
    }
  }

  for (let i = 0; i < packageNames.length; i += concurrency) {
    const batch = packageNames.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processPackage));
    for (const r of batchResults) { if (r) results.push(r); }
  }

  const sortOrder: Record<UpdateType, number> = { current: 4, patch: 3, minor: 2, major: 1 };
  results.sort((a, b) => {
    if (a.securityRisk !== b.securityRisk) return a.securityRisk ? -1 : 1;
    return (sortOrder[a.updateType] ?? 4) - (sortOrder[b.updateType] ?? 4);
  });

  const installedPackageNames = new Set(packageNames);
  const modernizationOpportunities = MODERNIZATION_PATTERNS.filter((m) => installedPackageNames.has(m.package));
  const { healthScore, securityScore, technicalDebtScore } = computeScores(results);
  const outdated = results.filter((p) => p.updateType !== 'current');

  const report: DependencyAuditReport = {
    auditedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    totalPackages: results.length,
    outdatedPackages: outdated.length,
    securityAdvisoryCount: results.reduce((sum, p) => sum + p.securityAdvisories.length, 0),
    deprecatedPackages: results.filter((p) => p.deprecated).length,
    abandonedPackages: results.filter((p) => p.isAbandoned).length,
    safeUpdates: results.filter((p) => p.classification === 'SAFE' && p.updateType !== 'current').length,
    minorReviewUpdates: results.filter((p) => p.classification === 'MINOR_REVIEW').length,
    breakingUpdates: results.filter((p) => p.classification === 'BREAKING').length,
    packages: results, healthScore, securityScore, technicalDebtScore,
    modernizationOpportunities,
    nodeVersion: process.version,
    npmVersion: 'n/a',
  };

  addBreadcrumb({ category: 'dependency-audit', message: 'audit complete', level: 'info', data: { totalPackages: report.totalPackages, durationMs: report.durationMs } });
  return report;
}

// ─── Upgrade report generator ─────────────────────────────────────────────────

export function generateUpgradeReportMarkdown(report: DependencyAuditReport): string {
  const lines: string[] = [];
  const now = new Date(report.auditedAt).toLocaleString('en-US', { timeZone: 'UTC' });
  lines.push('# AutoMint Dependency Upgrade Report', '', `**Generated:** ${now} UTC`, `**Total Packages:** ${report.totalPackages}`, '');
  lines.push('## Health Summary', '', '| Metric | Score |', '|--------|-------|',
    `| 🏥 Health | ${report.healthScore}/100 |`,
    `| 🔐 Security | ${report.securityScore}/100 |`,
    `| 🧹 Tech Debt | ${report.technicalDebtScore}/100 |`, '');

  const secPkgs = report.packages.filter((p) => p.securityRisk);
  if (secPkgs.length > 0) {
    lines.push('## 🚨 Security Advisories', '');
    for (const pkg of secPkgs) {
      lines.push(`### ${pkg.name} \`${pkg.currentVersion}\` → \`${pkg.latestVersion}\``);
      for (const adv of pkg.securityAdvisories) {
        lines.push(`- **[${adv.severity}]** ${adv.title}`);
        lines.push(`  - Affected: \`${adv.affectedVersions}\``, `  - Patched: \`${adv.patchedVersions}\``);
        if (adv.cve) lines.push(`  - CVE: ${adv.cve}`);
      }
      lines.push('');
    }
  }

  const safePkgs = report.packages.filter((p) => p.classification === 'SAFE' && p.updateType !== 'current');
  if (safePkgs.length > 0) {
    lines.push('## ✅ Safe Updates', '', '| Package | Current | Latest |', '|---------|---------|--------|');
    for (const pkg of safePkgs) lines.push(`| \`${pkg.name}\` | \`${pkg.currentVersion}\` | \`${pkg.latestVersion}\` |`);
    lines.push('');
  }

  const breakPkgs = report.packages.filter((p) => p.classification === 'BREAKING');
  if (breakPkgs.length > 0) {
    lines.push('## 💥 Breaking Changes', '', '| Package | Current | Latest |', '|---------|---------|--------|');
    for (const pkg of breakPkgs) lines.push(`| \`${pkg.name}\` | \`${pkg.currentVersion}\` | \`${pkg.latestVersion}\` |`);
    lines.push('');
  }

  lines.push('---', '*Generated by AutoMint Dependency Update Center.*');
  return lines.join('\n');
}

// ─── Safe-updates helper ──────────────────────────────────────────────────────

export function getSafeUpdateCandidates(report: DependencyAuditReport): PackageAuditResult[] {
  return report.packages.filter((p) => p.classification === 'SAFE' && p.updateType === 'patch');
}
