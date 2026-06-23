/**
 * POST /api/system/upgrade-branch
 *
 * Create a git branch named `upgrade/YYYY-MM-DD`, bump selected packages,
 * commit the result, and return a summary.
 *
 * Admin-only endpoint.
 *
 * Body:
 * {
 *   packageNames?: string[]   // Subset to update. Defaults to ALL safe patch updates.
 *   includeMinor?: boolean    // Also include MINOR_REVIEW packages (default: false)
 *   branchSuffix?: string     // e.g. "-security" → "upgrade/2025-06-22-security"
 * }
 *
 * Response:
 * {
 *   branchName: string
 *   packagesUpdated: [{ name, from, to }]
 *   breakingChangesDetected: [{ name, currentVersion, latestVersion }]
 *   commitHash?: string
 * }
 *
 * NOTE: Requires git to be available in the execution environment.
 *       Not available on Vercel serverless runtime — designed for CI/CD use.
 */

import { NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
  runDependencyAudit,
  type PackageAuditResult,
} from '@/lib/services/dependency-audit.service';
import { captureException, captureMessage } from '@/lib/observability/sentry';
import { parseJsonBody } from '@/lib/api/errors';

const execAsync = promisify(exec);
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface UpgradeBranchBody {
  packageNames?: string[];
  includeMinor?: boolean;
  branchSuffix?: string;
}

async function git(command: string): Promise<string> {
  const { stdout } = await execAsync(`git ${command}`, {
    cwd: process.cwd(),
    timeout: 30_000,
  });
  return stdout.trim();
}

async function gitAvailable(): Promise<boolean> {
  try {
    await git('--version');
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  if (!(await gitAvailable())) {
    return NextResponse.json(
      {
        error:
          'git is not available in this environment. ' +
          'Upgrade branch creation requires a git-enabled CI/development environment.',
      },
      { status: 503 },
    );
  }

  const body = await parseJsonBody<UpgradeBranchBody>(request).catch(() => ({} as UpgradeBranchBody));
  const { packageNames, includeMinor = false, branchSuffix = '' } = body;

  try {
    // ── 1. Audit current state ──────────────────────────────────────────
    const report = await runDependencyAudit({ devPackages: true });

    // ── 2. Decide which packages to update ─────────────────────────────
    let candidates: PackageAuditResult[] = report.packages.filter((p) => {
      if (p.updateType === 'current') return false;
      if (p.classification === 'SAFE') return true;
      if (includeMinor && p.classification === 'MINOR_REVIEW') return true;
      return false;
    });

    if (packageNames && packageNames.length > 0) {
      const requested = new Set(packageNames);
      candidates = candidates.filter((p) => requested.has(p.name));
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        branchName: null,
        packagesUpdated: [],
        breakingChangesDetected: report.packages
          .filter((p) => p.classification === 'BREAKING')
          .map((p) => ({ name: p.name, currentVersion: p.currentVersion, latestVersion: p.latestVersion })),
        message: 'No eligible packages to update.',
      });
    }

    // ── 3. Create branch ───────────────────────────────────────────────
    const datePart = new Date().toISOString().split('T')[0];
    const suffix = branchSuffix ? `-${branchSuffix.replace(/[^a-zA-Z0-9-]/g, '')}` : '';
    const branchName = `upgrade/${datePart}${suffix}`;

    // Ensure we are on a clean working tree before branching
    try {
      const status = await git('status --porcelain');
      if (status.trim()) {
        return NextResponse.json(
          { error: 'Working tree is not clean. Commit or stash changes before creating an upgrade branch.' },
          { status: 409 },
        );
      }
    } catch {
      // Proceed anyway if status check fails
    }

    await git(`checkout -b ${branchName}`);

    // ── 4. Install selected packages ────────────────────────────────────
    const updated: Array<{ name: string; from: string; to: string }> = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const pkg of candidates) {
      try {
        const flag = pkg.isDev ? '--save-dev' : '--save';
        await execAsync(`npm install ${flag} ${pkg.name}@${pkg.latestVersion}`, {
          cwd: process.cwd(),
          timeout: 30_000,
        });
        updated.push({ name: pkg.name, from: pkg.currentVersion, to: pkg.latestVersion });
      } catch (err) {
        failed.push({ name: pkg.name, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── 5. Commit ────────────────────────────────────────────────────────
    let commitHash: string | undefined;
    if (updated.length > 0) {
      await git('add package.json package-lock.json');

      const commitMsg = [
        `chore(deps): upgrade ${updated.length} package(s) [${datePart}]`,
        '',
        'Updated packages:',
        ...updated.map((u) => `  - ${u.name}: ${u.from} → ${u.to}`),
        '',
        'Generated by AutoMint Dependency Update Center',
      ].join('\n');

      await execAsync(`git commit -m ${JSON.stringify(commitMsg)}`, {
        cwd: process.cwd(),
        timeout: 15_000,
      });

      commitHash = await git('rev-parse --short HEAD');
    }

    // ── 6. Switch back to original branch ───────────────────────────────
    try {
      await git('checkout -');
    } catch {
      // Non-fatal
    }

    const breakingChangesDetected = report.packages
      .filter((p) => p.classification === 'BREAKING')
      .map((p) => ({
        name: p.name,
        currentVersion: p.currentVersion,
        latestVersion: p.latestVersion,
      }));

    await captureMessage('Upgrade branch created', {
      area: 'dependency-audit',
      level: 'info',
      context: {
        userId: auth.userId,
        branchName,
        packagesUpdated: updated.length,
        packagesFailed: failed.length,
        commitHash,
      },
      fingerprint: ['dependency-audit', 'upgrade-branch'],
    });

    return NextResponse.json({
      ok: true,
      branchName,
      packagesUpdated: updated,
      packagesFailed: failed,
      breakingChangesDetected,
      commitHash,
    });
  } catch (error) {
    // Attempt cleanup: switch back if we created a branch
    try { await git('checkout -'); } catch { /* ignore */ }

    await captureException(error, {
      area: 'dependency-audit',
      context: { userId: auth.userId },
      fingerprint: ['dependency-audit', 'upgrade-branch'],
    });
    const message = error instanceof Error ? error.message : 'Upgrade branch creation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
