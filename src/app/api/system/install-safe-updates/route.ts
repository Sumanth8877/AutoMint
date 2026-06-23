/**
 * POST /api/system/install-safe-updates
 *
 * Install only SAFE (patch-level) dependency updates.
 * Runs `npm install pkg@latest` for each qualifying package.
 *
 * Admin-only endpoint.
 *
 * Body: { packageNames?: string[] }  — optional filter; if omitted installs ALL safe updates.
 *
 * Response:
 * {
 *   updated: [{ name, from, to }]
 *   skipped: [{ name, reason }]
 *   failed:  [{ name, error }]
 * }
 *
 * SAFETY RULES enforced here:
 *   - Only packages with updateType === 'patch' are ever installed.
 *   - Packages with securityRisk=true and updateType > patch are still SKIPPED (not force-installed).
 *   - This endpoint NEVER installs major or minor updates.
 */

import { NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
  runDependencyAudit,
  getSafeUpdateCandidates,
  type PackageAuditResult,
} from '@/lib/services/dependency-audit.service';
import { captureException, captureMessage } from '@/lib/observability/sentry';
import { parseJsonBody } from '@/lib/api/errors';

const execAsync = promisify(exec);
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface InstallBody {
  packageNames?: string[];
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  // Note: npm install is only available in build/CI environments.
  // On Vercel production runtime, the filesystem is read-only and npm is not present.
  // This endpoint is designed for use in development / CI environments.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_RUNTIME_INSTALLS !== 'true') {
    return NextResponse.json(
      {
        error:
          'Runtime package installation is disabled in production. ' +
          'Set ALLOW_RUNTIME_INSTALLS=true to enable (CI/development environments only).',
      },
      { status: 403 },
    );
  }

  const body = await parseJsonBody<InstallBody>(request).catch(() => ({}) as InstallBody);
  const requestedPackages = body.packageNames;

  try {
    // 1. Re-run audit to get current state
    const report = await runDependencyAudit({ devPackages: true });
    let candidates = getSafeUpdateCandidates(report);

    // 2. Filter to requested subset if provided
    if (requestedPackages && requestedPackages.length > 0) {
      const requested = new Set(requestedPackages);
      candidates = candidates.filter((p) => requested.has(p.name));

      // Check if any requested package was excluded (non-SAFE)
      const requestedSkipped = requestedPackages.filter(
        (name) => !candidates.find((c) => c.name === name),
      );
      if (requestedSkipped.length > 0) {
        const nonSafe = report.packages.filter((p) => requestedSkipped.includes(p.name));
        for (const pkg of nonSafe) {
          await captureMessage('Skipped non-safe install request', {
            area: 'dependency-audit',
            level: 'warning',
            context: {
              userId: auth.userId,
              package: pkg.name,
              updateType: pkg.updateType,
              classification: pkg.classification,
            },
            fingerprint: ['dependency-audit', 'skip-non-safe'],
          });
        }
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        updated: [],
        skipped: [{ name: '*', reason: 'No safe patch updates available' }],
        failed: [],
      });
    }

    const updated: Array<{ name: string; from: string; to: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    const failed: Array<{ name: string; error: string }> = [];

    // 3. Install each safe candidate individually for granular error handling
    for (const pkg of candidates) {
      // Final safety gate — re-verify classification is still SAFE
      if (pkg.classification !== 'SAFE' || pkg.updateType !== 'patch') {
        skipped.push({
          name: pkg.name,
          reason: `Skipped: ${pkg.classification} update (${pkg.updateType}). Only patch updates are installed.`,
        });
        continue;
      }

      try {
        const installTarget = pkg.isDev
          ? `npm install --save-dev ${pkg.name}@${pkg.latestVersion}`
          : `npm install --save ${pkg.name}@${pkg.latestVersion}`;

        await execAsync(installTarget, {
          cwd: process.cwd(),
          timeout: 30_000,
        });

        updated.push({
          name: pkg.name,
          from: pkg.currentVersion,
          to: pkg.latestVersion,
        });

        await captureMessage('Safe package update installed', {
          area: 'dependency-audit',
          level: 'info',
          context: {
            userId: auth.userId,
            package: pkg.name,
            from: pkg.currentVersion,
            to: pkg.latestVersion,
          },
          fingerprint: ['dependency-audit', 'install'],
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failed.push({ name: pkg.name, error: errMsg });
        await captureException(err, {
          area: 'dependency-audit',
          context: { userId: auth.userId, package: pkg.name },
          fingerprint: ['dependency-audit', 'install-failed'],
        });
      }
    }

    return NextResponse.json({ ok: true, updated, skipped, failed });
  } catch (error) {
    await captureException(error, {
      area: 'dependency-audit',
      context: { userId: auth.userId },
      fingerprint: ['dependency-audit', 'install-safe-updates'],
    });
    const message = error instanceof Error ? error.message : 'Install failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
