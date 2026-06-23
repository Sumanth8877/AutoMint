/**
 * dependency-audit.service.ts
 *
 * Dependency Update Center — audit engine.
 *
 * Responsibilities:
 *   1. Read package.json (never modifies it)
 *   2. Fetch live npm registry metadata for every listed package
 *   3. Compare installed vs. latest semver ranges
 *   4. Detect: outdated, deprecated, abandoned, security advisories
 *   5. Classify each package as SAFE | MINOR_REVIEW | BREAKING
 *   6. Detect framework-specific deprecated API patterns
 *   7. Score overall health, security, and technical debt
 *
 * SAFETY CONTRACT:
 *   This service is READ-ONLY. It NEVER writes files, NEVER
 *   runs npm install, and NEVER modifies package.json.
 */

import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import { addBreadcrumb, captureException } from '@/lib/observability/sentry';

// ─── Types ─────────────────────────────────────────────────────────────────

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

export interface InstallSafeUpdatesResult {
  updated: Array<{ name: string; from: string; to: string }>;
  skipped: Array<{ name: string; reason: string }>;
  failed: Array<{ name: string; error: string }>;
}

// ─── Semver helpers ─────────────────────────────────────────────────────────

/** Strip npm range prefix and return clean X.Y.Z */
function stripRange(version: string): string {
  return version.replace(/^[\^~>=<*\s]+/, '').split(' ')[0] ?? '0.0.0';
}

function parseSemver(version: string): [number, number, number] {
  const clean = stripRange(version).split('-')[0]; // drop pre-release
  const parts = (clean ?? '').split('.').map((p) => parseInt(p, 10) || 0);
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
  return 'SAFE'; // 'current' → no action needed, treat as safe
}

// ─── npm registry helpers ───────────────────────────────────────────────────

interface NpmPackageData {
  name: string;
  description?: string;
  deprecated?: string;
  homepage?: string;
  repository?: { url?: string };
  'dist-tags': { latest: string };
  time?: Record<string, string>;
  versions?: Record<string, { deprecated?: string }>;
}

const NPM_REGISTRY = 'https://registry.npmjs.org';
const NPM_DOWNLOADS_API = 'https://api.npmjs.org';
const FETCH_TIMEOUT_MS = 8_000;
const ABANDONED_THRESHOLD_DAYS = 730; // 2 years

async function fetchPackageMetadata(name: string): Promise<NpmPackageData | null> {
  try {
    const encodedName = encodeURIComponent(name).replace(/%40/g, '@').replace(/%2F/g, '/');
    const res = await fetch(`${NPM_REGISTRY}/${encodedName}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Next.js cache: revalidate every 5 minutes to avoid hammering npm
      next: { revalidate: 300 },
    } as RequestInit);
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
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        next: { revalidate: 600 },
      } as RequestInit,
    );
    if (!res.ok) return null;
    const data = await res.json() as { downloads?: number };
    return data.downloads ?? null;
  } catch {
    return null;
  }
}

// ─── Security advisory helpers ──────────────────────────────────────────────

interface NpmAuditAdvisory {
  id: number;
  module_name?: string;
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

    const body = JSON.stringify({
      name: 'automint-audit',
      version: '0.0.0',
      requires,
      dependencies,
    });

    const res = await fetch(`${NPM_REGISTRY}/-/npm/v1/security/audits/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return result;

    const data = await res.json() as NpmBulkAuditResponse;
    const advisories = data.advisories ?? {};

    for (const advisory of Object.values(advisories)) {
      // The advisory doesn't directly expose the package name in older API versions;
      // match by vulnerable_versions against our package list.
      // We use the module_name field if present, otherwise iterate.
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
  } catch {
    // Advisory fetch failure is non-fatal — we still return the structural audit
  }

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

// ─── Modernization patterns ─────────────────────────────────────────────────

const MODERNIZATION_PATTERNS: ModernizationOpportunity[] = [
  {
    package: 'next',
    type: 'deprecated-api',
    description: 'Next.js 16 introduced server-first defaults. Verify all `getServerSideProps` and `getStaticProps` usages have been migrated to App Router data-fetching patterns.',
    recommendation: 'Audit pages/ directory for legacy data-fetching functions and migrate to React Server Components + fetch() with caching options.',
    effort: 'high',
    docsUrl: 'https://nextjs.org/docs/app/building-your-application/upgrading/app-router-migration',
  },
  {
    package: 'next',
    type: 'performance',
    description: 'Next.js `<Image>` component with unoptimized={true} disables all optimizations. Audit for this prop.',
    recommendation: 'Remove `unoptimized` from all <Image> usages and configure a proper image loader.',
    effort: 'low',
    docsUrl: 'https://nextjs.org/docs/app/api-reference/components/image',
  },
  {
    package: 'react',
    type: 'deprecated-api',
    description: 'React 19 removes deprecated `createFactory`, `isValidElement` type overloads, and the legacy Context API pattern.',
    recommendation: 'Replace `React.createContext` consumers using legacy contextType with the useContext hook.',
    effort: 'medium',
    docsUrl: 'https://react.dev/blog/2024/04/25/react-19-upgrade-guide',
  },
  {
    package: '@clerk/nextjs',
    type: 'deprecated-api',
    description: 'Clerk v7+ requires the `<ClerkProvider>` to wrap only server components. The `authMiddleware` helper was replaced by `clerkMiddleware`.',
    recommendation: 'Ensure middleware uses `clerkMiddleware()` from `@clerk/nextjs/server`, not the legacy `authMiddleware`.',
    effort: 'medium',
    docsUrl: 'https://clerk.com/docs/upgrade-guides/core-2',
  },
  {
    package: 'drizzle-orm',
    type: 'deprecated-api',
    description: 'Drizzle ORM 0.30+ deprecated the `.toSQL()` shorthand on queries. Use `.prepare()` for re-usable prepared statements.',
    recommendation: 'Replace `.toSQL()` calls with explicit prepared statements for performance and type-safety.',
    effort: 'low',
    docsUrl: 'https://orm.drizzle.team/docs/prepared-statements',
  },
  {
    package: 'drizzle-kit',
    type: 'security-hardening',
    description: 'drizzle-kit push is not safe for production deployments — it may drop columns. Use migration files instead.',
    recommendation: 'Switch vercel.json buildCommand from `db:push` to `db:migrate`. Generate migration files with `drizzle-kit generate`.',
    effort: 'medium',
    docsUrl: 'https://orm.drizzle.team/docs/migrations',
  },
  {
    package: 'viem',
    type: 'deprecated-api',
    description: 'Viem 2.x deprecated the legacy `JsonRpcProvider` in favor of the new transport system. Ensure all clients use `http()` or `webSocket()` transports.',
    recommendation: 'Audit all `createPublicClient` / `createWalletClient` calls to use the new transport API.',
    effort: 'low',
    docsUrl: 'https://viem.sh/docs/migration-guide.html',
  },
  {
    package: '@sentry/nextjs',
    type: 'deprecated-api',
    description: 'Sentry SDK v8+ deprecated `withSentryConfig` wrapping with legacy options. The tunnel route and source map upload API changed.',
    recommendation: 'Update `sentry.server.config.ts` and `sentry.client.config.ts` to use the new SDK 8 initialization API.',
    effort: 'medium',
    docsUrl: 'https://docs.sentry.io/platforms/javascript/guides/nextjs/migration/v7-to-v8/',
  },
  {
    package: '@upstash/redis',
    type: 'performance',
    description: 'Upstash Redis SDK 1.30+ supports pipeline batching. Audit sequential Redis calls that could be batched for latency reduction.',
    recommendation: 'Use `redis.pipeline()` for lock-acquire + expire sequences and bulk cache operations.',
    effort: 'medium',
    docsUrl: 'https://upstash.com/docs/redis/sdks/ts/pipeline',
  },
  {
    package: '@neondatabase/serverless',
    type: 'performance',
    description: 'Neon serverless driver v1.x supports connection pooling via the Pool class for high-concurrency routes.',
    recommendation: 'Consider using `Pool` instead of direct `neon()` connections for routes that execute multiple queries.',
    effort: 'medium',
    docsUrl: 'https://neon.tech/docs/serverless/serverless-driver',
  },
];

// ─── Package.json reader ────────────────────────────────────────────────────

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('package.json not found at project root');
  }
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PackageJson;
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function computeScores(packages: PackageAuditResult[]): {
  healthScore: number;
  securityScore: number;
  technicalDebtScore: number;
} {
  if (packages.length === 0) return { healthScore: 100, securityScore: 100, technicalDebtScore: 100 };

  const total = packages.length;

  // Security score: deduct per advisory severity
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

  // Technical debt score: proportion of up-to-date packages
  const outdated = packages.filter((p) => p.updateType !== 'current').length;
  const outdatedRatio = outdated / total;
  const technicalDebtScore = Math.max(0, Math.round(100 - outdatedRatio * 60));

  // Health score: composite
  const healthScore = Math.round((securityScore * 0.5 + technicalDebtScore * 0.5));

  return { healthScore, securityScore, technicalDebtScore };
}

// ─── Recommendation builder ─────────────────────────────────────────────────

function buildRecommendation(pkg: Omit<PackageAuditResult, 'recommendation'>): string {
  if (pkg.updateType === 'current') return 'Up to date. No action required.';

  const parts: string[] = [];

  if (pkg.securityRisk && pkg.securitySeverity) {
    parts.push(`⚠️ ${pkg.securitySeverity} security advisory — update immediately.`);
  }

  if (pkg.deprecated) {
    const msg = pkg.deprecationMessage
      ? `Deprecated: ${pkg.deprecationMessage}`
      : 'This package is deprecated. Migrate to a maintained alternative.';
    parts.push(msg);
  }

  if (pkg.isAbandoned) {
    parts.push('Package appears abandoned (no publish in 2+ years). Consider a maintained fork.');
  }

  if (pkg.updateType === 'patch') {
    parts.push(`Patch update available (${pkg.currentVersion} → ${pkg.latestVersion}). Safe to install.`);
  } else if (pkg.updateType === 'minor') {
    parts.push(`Minor update available (${pkg.currentVersion} → ${pkg.latestVersion}). Review changelog before updating.`);
  } else if (pkg.updateType === 'major') {
    parts.push(`Major update available (${pkg.currentVersion} → ${pkg.latestVersion}). Breaking changes likely — read migration guide.`);
  }

  return parts.join(' ') || 'Review and update when convenient.';
}

// ─── Main audit function ─────────────────────────────────────────────────────

/**
 * Run a full dependency audit.
 *
 * This function is READ-ONLY — it never writes any files.
 *
 * @param options.devPackages - Whether to include devDependencies (default: true)
 * @param options.concurrency - Max parallel npm registry requests (default: 8)
 */
export async function runDependencyAudit(options: {
  devPackages?: boolean;
  concurrency?: number;
} = {}): Promise<DependencyAuditReport> {
  const startMs = Date.now();
  const { devPackages = true, concurrency = 8 } = options;

  addBreadcrumb({
    category: 'dependency-audit',
    message: 'audit started',
    level: 'info',
    data: { devPackages, concurrency },
  });

  const pkg = readPackageJson();

  const prodDeps = pkg.dependencies ?? {};
  const devDeps = devPackages ? (pkg.devDependencies ?? {}) : {};

  const allDeps: Record<string, { version: string; isDev: boolean }> = {};
  for (const [name, version] of Object.entries(prodDeps)) {
    allDeps[name] = { version, isDev: false };
  }
  for (const [name, version] of Object.entries(devDeps)) {
    if (!allDeps[name]) allDeps[name] = { version, isDev: true };
  }

  const packageNames = Object.keys(allDeps);

  // ── Security advisories (single bulk call) ─────────────────────────────
  const allVersionsForAudit: Record<string, string> = {};
  for (const [name, { version }] of Object.entries(allDeps)) {
    allVersionsForAudit[name] = version;
  }
  const advisoriesByPackage = await fetchSecurityAdvisories(allVersionsForAudit);

  // ── Fetch registry metadata with bounded concurrency ──────────────────
  const results: PackageAuditResult[] = [];

  async function processPackage(name: string): Promise<PackageAuditResult | null> {
    const { version: installedRange, isDev } = allDeps[name]!;
    const installedVersion = stripRange(installedRange);

    try {
      const [meta, weeklyDownloads] = await Promise.all([
        fetchPackageMetadata(name),
        fetchWeeklyDownloads(name),
      ]);

      const latestVersion = meta?.['dist-tags']?.latest ?? installedVersion;
      const updateType = classifyUpdate(installedVersion, latestVersion);
      const classification = toClassification(updateType);

      // Deprecation: check the latest version's metadata
      const latestVersionMeta = meta?.versions?.[latestVersion];
      const deprecated = Boolean(
        meta?.deprecated ??
        latestVersionMeta?.deprecated ??
        false,
      );
      const deprecationMessage =
        typeof meta?.deprecated === 'string'
          ? meta.deprecated
          : typeof latestVersionMeta?.deprecated === 'string'
            ? latestVersionMeta.deprecated
            : null;

      // Abandonment: last publish > 2 years ago
      const lastPublishDate = meta?.time?.[latestVersion] ?? meta?.time?.modified;
      let lastPublishDaysAgo: number | null = null;
      let isAbandoned = false;
      if (lastPublishDate) {
        const diffMs = Date.now() - new Date(lastPublishDate).getTime();
        lastPublishDaysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        isAbandoned = lastPublishDaysAgo > ABANDONED_THRESHOLD_DAYS;
      }

      // Security
      const securityAdvisories = advisoriesByPackage.get(name) ?? [];
      const securitySeverity = highestSeverity(securityAdvisories);
      const securityRisk = securityAdvisories.length > 0;

      // Changelog URL heuristic
      const repoUrl = meta?.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
      const changelogUrl = repoUrl
        ? `${repoUrl}/blob/main/CHANGELOG.md`
        : null;

      const partial: Omit<PackageAuditResult, 'recommendation'> = {
        name,
        currentVersion: installedVersion,
        latestVersion,
        wantedVersion: installedVersion, // wanted = currently resolved (no lockfile parse)
        updateType,
        classification,
        isDev,
        deprecated,
        deprecationMessage,
        isAbandoned,
        lastPublishDaysAgo,
        weeklyDownloads,
        securityRisk,
        securitySeverity,
        securityAdvisories,
        changelogUrl,
        homepage: meta?.homepage ?? null,
      };

      return {
        ...partial,
        recommendation: buildRecommendation(partial),
      };
    } catch (error) {
      await captureException(error, {
        area: 'dependency-audit',
        context: { package: name },
        fingerprint: ['dependency-audit', 'package-fetch'],
      });
      return null;
    }
  }

  // Process packages in batches of `concurrency`
  for (let i = 0; i < packageNames.length; i += concurrency) {
    const batch = packageNames.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processPackage));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  // Sort: security issues first, then breaking, then minor, then patch, then current
  const sortOrder: Record<UpdateType, number> = {
    current: 4,
    patch: 3,
    minor: 2,
    major: 1,
  };
  results.sort((a, b) => {
    // Security always floats to top
    if (a.securityRisk !== b.securityRisk) return a.securityRisk ? -1 : 1;
    return (sortOrder[a.updateType] ?? 4) - (sortOrder[b.updateType] ?? 4);
  });

  // ── Modernization opportunities ─────────────────────────────────────
  const installedPackageNames = new Set(packageNames);
  const modernizationOpportunities = MODERNIZATION_PATTERNS.filter((m) =>
    installedPackageNames.has(m.package),
  );

  // ── Scoring ──────────────────────────────────────────────────────────
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
    packages: results,
    healthScore,
    securityScore,
    technicalDebtScore,
    modernizationOpportunities,
    nodeVersion: process.version,
    npmVersion: 'n/a', // npm is not available in Vercel serverless — omit
  };

  addBreadcrumb({
    category: 'dependency-audit',
    message: 'audit complete',
    level: 'info',
    data: {
      totalPackages: report.totalPackages,
      outdated: report.outdatedPackages,
      security: report.securityAdvisoryCount,
      durationMs: report.durationMs,
    },
  });

  return report;
}

// ─── Upgrade report generator ────────────────────────────────────────────────

/**
 * Generate a Markdown upgrade report from an audit report.
 * READ-ONLY — no side effects.
 */
export function generateUpgradeReportMarkdown(report: DependencyAuditReport): string {
  const lines: string[] = [];

  const now = new Date(report.auditedAt).toLocaleString('en-US', { timeZone: 'UTC' });

  lines.push('# AutoMint Dependency Upgrade Report');
  lines.push('');
  lines.push(`**Generated:** ${now} UTC`);
  lines.push(`**Node Version:** ${report.nodeVersion}`);
  lines.push(`**Total Packages Audited:** ${report.totalPackages}`);
  lines.push(`**Audit Duration:** ${report.durationMs}ms`);
  lines.push('');

  // ── Summary scores ───────────────────────────────────────────────────
  lines.push('## Health Summary');
  lines.push('');
  lines.push(`| Metric | Score |`);
  lines.push(`|--------|-------|`);
  lines.push(`| 🏥 Overall Health | ${report.healthScore}/100 |`);
  lines.push(`| 🔐 Security | ${report.securityScore}/100 |`);
  lines.push(`| 🧹 Technical Debt | ${report.technicalDebtScore}/100 |`);
  lines.push('');

  // ── Stats ─────────────────────────────────────────────────────────────
  lines.push('## Audit Statistics');
  lines.push('');
  lines.push(`| Category | Count |`);
  lines.push(`|----------|-------|`);
  lines.push(`| 📦 Total Packages | ${report.totalPackages} |`);
  lines.push(`| 📈 Outdated | ${report.outdatedPackages} |`);
  lines.push(`| 🚨 Security Advisories | ${report.securityAdvisoryCount} |`);
  lines.push(`| ⚠️ Deprecated | ${report.deprecatedPackages} |`);
  lines.push(`| 🪦 Abandoned | ${report.abandonedPackages} |`);
  lines.push(`| ✅ Safe Updates | ${report.safeUpdates} |`);
  lines.push(`| 🔍 Minor Review | ${report.minorReviewUpdates} |`);
  lines.push(`| 💥 Breaking Changes | ${report.breakingUpdates} |`);
  lines.push('');

  // ── Security advisories ───────────────────────────────────────────────
  const securityPkgs = report.packages.filter((p) => p.securityRisk);
  if (securityPkgs.length > 0) {
    lines.push('## 🚨 Security Advisories');
    lines.push('');
    lines.push('> These packages have known security vulnerabilities and should be updated immediately.');
    lines.push('');
    for (const pkg of securityPkgs) {
      lines.push(`### ${pkg.name} \`${pkg.currentVersion}\` → \`${pkg.latestVersion}\``);
      for (const adv of pkg.securityAdvisories) {
        lines.push(`- **[${adv.severity}]** ${adv.title}`);
        lines.push(`  - Affected: \`${adv.affectedVersions}\``);
        lines.push(`  - Patched: \`${adv.patchedVersions}\``);
        if (adv.cve) lines.push(`  - CVE: ${adv.cve}`);
        lines.push(`  - Details: ${adv.url}`);
      }
      lines.push('');
    }
  }

  // ── Deprecated ───────────────────────────────────────────────────────
  const deprecatedPkgs = report.packages.filter((p) => p.deprecated);
  if (deprecatedPkgs.length > 0) {
    lines.push('## ⚠️ Deprecated Packages');
    lines.push('');
    lines.push('| Package | Version | Message |');
    lines.push('|---------|---------|---------|');
    for (const pkg of deprecatedPkgs) {
      const msg = pkg.deprecationMessage ?? 'No message provided';
      lines.push(`| \`${pkg.name}\` | \`${pkg.currentVersion}\` | ${msg} |`);
    }
    lines.push('');
  }

  // ── Safe updates ──────────────────────────────────────────────────────
  const safePkgs = report.packages.filter(
    (p) => p.classification === 'SAFE' && p.updateType !== 'current',
  );
  if (safePkgs.length > 0) {
    lines.push('## ✅ Safe Updates (Patch)');
    lines.push('');
    lines.push('These can be installed automatically without risk of breaking changes.');
    lines.push('');
    lines.push('| Package | Current | Latest | Type |');
    lines.push('|---------|---------|--------|------|');
    for (const pkg of safePkgs) {
      const devTag = pkg.isDev ? ' *(dev)*' : '';
      lines.push(`| \`${pkg.name}\`${devTag} | \`${pkg.currentVersion}\` | \`${pkg.latestVersion}\` | ${pkg.updateType} |`);
    }
    lines.push('');
  }

  // ── Minor review ──────────────────────────────────────────────────────
  const minorPkgs = report.packages.filter((p) => p.classification === 'MINOR_REVIEW');
  if (minorPkgs.length > 0) {
    lines.push('## 🔍 Minor Updates — Review Required');
    lines.push('');
    lines.push('| Package | Current | Latest | Downloads/week |');
    lines.push('|---------|---------|--------|----------------|');
    for (const pkg of minorPkgs) {
      const dl = pkg.weeklyDownloads != null ? pkg.weeklyDownloads.toLocaleString() : 'N/A';
      lines.push(`| \`${pkg.name}\` | \`${pkg.currentVersion}\` | \`${pkg.latestVersion}\` | ${dl} |`);
    }
    lines.push('');
  }

  // ── Breaking changes ──────────────────────────────────────────────────
  const breakingPkgs = report.packages.filter((p) => p.classification === 'BREAKING');
  if (breakingPkgs.length > 0) {
    lines.push('## 💥 Breaking Changes — Manual Migration Required');
    lines.push('');
    lines.push('| Package | Current | Latest | Changelog |');
    lines.push('|---------|---------|--------|-----------|');
    for (const pkg of breakingPkgs) {
      const cl = pkg.changelogUrl ? `[View](${pkg.changelogUrl})` : 'N/A';
      lines.push(`| \`${pkg.name}\` | \`${pkg.currentVersion}\` | \`${pkg.latestVersion}\` | ${cl} |`);
    }
    lines.push('');
  }

  // ── Modernization ─────────────────────────────────────────────────────
  if (report.modernizationOpportunities.length > 0) {
    lines.push('## 🔧 Modernization Opportunities');
    lines.push('');
    for (const opp of report.modernizationOpportunities) {
      const effortBadge = { low: '🟢 Low', medium: '🟡 Medium', high: '🔴 High' }[opp.effort];
      lines.push(`### ${opp.package} — ${opp.description.split('.')[0]}`);
      lines.push('');
      lines.push(`**Effort:** ${effortBadge}`);
      lines.push('');
      lines.push(`${opp.description}`);
      lines.push('');
      lines.push(`**Recommendation:** ${opp.recommendation}`);
      if (opp.docsUrl) lines.push(`**Docs:** ${opp.docsUrl}`);
      lines.push('');
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('*Generated by AutoMint Dependency Update Center.*');
  lines.push('*Review all changes in a development branch before merging to production.*');

  return lines.join('\n');
}

// ─── Safe-updates helper ─────────────────────────────────────────────────────

/**
 * Returns the subset of packages that qualify for safe (patch-only) installation.
 * Does NOT install anything — just filters the list.
 */
export function getSafeUpdateCandidates(report: DependencyAuditReport): PackageAuditResult[] {
  return report.packages.filter(
    (p) => p.classification === 'SAFE' && p.updateType === 'patch',
  );
}
