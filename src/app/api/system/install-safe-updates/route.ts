/**
 * POST /api/system/install-safe-updates
 *
 * Install only SAFE (patch-level) dependency updates.
 *
 * Requires: authenticated user session.
 *
 * Body: { packageNames?: string[] }
 *
 * SAFETY RULES:
 *   - Only packages with updateType === 'patch' are ever installed.
 *   - Never installs major or minor updates.
 *   - Disabled in production unless ALLOW_RUNTIME_INSTALLS=true.
 */

import { NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { requireApiUser } from '@/lib/auth/require-auth';
import {
  runDependencyAudit,
  getSafeUpdateCandidates,
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
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

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
    const report = await runDependencyAudit({ devPackages: true });
    let candidates = getSafeUpdateCandidates(report);

    if (requestedPackages && requestedPackages.length > 0) {
      const requested = new Set(requestedPackages);
      candidates = candidates.filter((p) => requested.has(p.name));
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

    for (const pkg of candidates) {
      if (pkg.classification !== 'SAFE' || pkg.updateType !== 'patch') {
        skipped.push({ name: pkg.name, reason: `Skipped: ${pkg.classification} update (${pkg.updateType}). Only patch updates are installed.` });
        continue;
      }

      try {
        const flag = pkg.isDev ? '--save-dev' : '--save';
        await execAsync(`npm install ${flag} ${pkg.name}@${pkg.latestVersion}`, {
          cwd: process.cwd(),
          timeout: 30_000,
        });
        updated.push({ name: pkg.name, from: pkg.currentVersion, to: pkg.latestVersion });
        await captureMessage('Safe package update installed', {
          area: 'dependency-audit',
          level: 'info',
          context: { userId: auth.userId, package: pkg.name, from: pkg.currentVersion, to: pkg.latestVersion },
          fingerprint: ['dependency-audit', 'install'],
        });
      } catch (err) {
        failed.push({ name: pkg.name, error: err instanceof Error ? err.message : String(err) });
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
