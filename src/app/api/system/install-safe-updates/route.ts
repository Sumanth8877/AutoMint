/**
 * POST /api/system/install-safe-updates
 *
 * Install SAFE (patch-level) dependency updates on Vercel production.
 *
 * Strategy: Vercel's filesystem is read-only — npm install cannot run at
 * runtime. Instead, this route uses the GitHub API to commit the updated
 * package.json directly to the repository. Vercel detects the push, triggers
 * a new deployment, and runs `npm install` during the build — which resolves
 * the new versions and regenerates the lockfile automatically.
 *
 * Flow:
 *   1. Run dependency audit to find safe patch updates
 *   2. Fetch the current package.json via GitHub Contents API
 *   3. Update version strings (preserving ^ ~ prefixes)
 *   4. Commit the updated package.json back to the default branch
 *   5. Vercel auto-deploys → packages installed during build
 *
 * Required env vars:
 *   GITHUB_PAT    — personal access token with repo:contents write permission
 *   GITHUB_OWNER  — repo owner (default: Sumanth8877)
 *   GITHUB_REPO   — repo name  (default: AutoMint)
 *
 * Body: { packageNames?: string[] }
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import {
  runDependencyAudit,
  getSafeUpdateCandidates,
  type PackageAuditResult,
} from '@/lib/services/dependency-audit.service';
import { captureException, captureMessage } from '@/lib/observability/sentry';
import { parseJsonBody } from '@/lib/api/errors';
import { invalidateCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';
// maxDuration removed — using Vercel hobby plan default (10s)

interface InstallBody {
  packageNames?: string[];
}

interface GitHubFileResponse {
  content: string;
  sha: string;
  html_url?: string;
}

interface GitHubCommitResponse {
  commit: { sha: string };
}

function getGitHubConfig() {
  const token = process.env.GITHUB_PAT ?? process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo  = process.env.GITHUB_REPO;

  // M-2 fix: never silently use hardcoded defaults for owner/repo.
  // A missing var would commit to the wrong repo — fail explicitly instead.
  if (!owner || !repo) {
    throw new Error(
      'GITHUB_OWNER and GITHUB_REPO must be set in your environment. ' +
      'Add them to your Vercel environment variables.',
    );
  }

  return { token, owner, repo };
}

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
};

/**
 * Commit an updated package.json to GitHub so Vercel triggers a new build.
 * Returns the short commit SHA on success.
 */
async function commitPackageJsonToGitHub(
  candidates: PackageAuditResult[],
): Promise<{ ok: true; commitSha: string; updatedPackages: string[] } | { ok: false; error: string }> {
  const { token, owner, repo } = getGitHubConfig();

  if (!token) {
    return { ok: false, error: 'GITHUB_PAT / GITHUB_TOKEN is not configured. Set it in your Vercel environment variables.' };
  }

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  const base = `https://api.github.com/repos/${owner}/${repo}/contents`;

  // 1. Fetch current package.json from GitHub
  const fileRes = await fetch(`${base}/package.json`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!fileRes.ok) {
    const text = await fileRes.text().catch(() => '');
    return { ok: false, error: `GitHub API error fetching package.json: ${fileRes.status} — ${text.slice(0, 200)}` };
  }

  const fileData = await fileRes.json() as GitHubFileResponse;

  // 2. Decode and parse
  const currentJson = Buffer.from(fileData.content.replace(/\n/g, ''), 'base64').toString('utf8');
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(currentJson) as PackageJson;
  } catch {
    return { ok: false, error: 'Failed to parse package.json from GitHub' };
  }

  // 3. Apply version updates (preserving range prefix: ^, ~, >=, etc.)
  const updatedPackages: string[] = [];
  for (const candidate of candidates) {
    const target = candidate.isDev ? pkg.devDependencies : pkg.dependencies;
    if (!target || !(candidate.name in target)) continue;

    const current = target[candidate.name] ?? '';
    // Preserve the semver range prefix so `^1.2.3` stays as `^1.2.4`
    const prefix = current.match(/^[\^~>=<*\s]+/)?.[0] ?? '';
    target[candidate.name] = `${prefix}${candidate.latestVersion}`;
    updatedPackages.push(`${candidate.name}@${candidate.latestVersion}`);
  }

  if (updatedPackages.length === 0) {
    return { ok: false, error: 'None of the safe packages were found in package.json' };
  }

  // 4. Encode updated JSON (preserve formatting)
  const updatedJson = JSON.stringify(pkg, null, 2) + '\n';
  const encoded = Buffer.from(updatedJson).toString('base64');

  // 5. Commit via GitHub API
  const datePart = new Date().toISOString().split('T')[0];
  const commitMsg = [
    `chore(deps): install ${updatedPackages.length} safe patch update(s) [${datePart}]`,
    '',
    'Updated packages:',
    ...updatedPackages.map(p => `  - ${p}`),
    '',
    'Committed by AutoMint Dependency Update Center.',
    'Vercel will redeploy automatically and run npm install during build.',
  ].join('\n');

  const commitRes = await fetch(`${base}/package.json`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: commitMsg,
      content: encoded,
      sha: fileData.sha,   // required by GitHub API for updates
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!commitRes.ok) {
    const text = await commitRes.text().catch(() => '');
    return { ok: false, error: `GitHub API commit failed: ${commitRes.status} — ${text.slice(0, 300)}` };
  }

  const commitData = await commitRes.json() as GitHubCommitResponse;
  return {
    ok: true,
    commitSha: commitData.commit.sha.slice(0, 7),
    updatedPackages,
  };
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await parseJsonBody<InstallBody>(request).catch(() => ({}) as InstallBody);
  const requestedPackages = body.packageNames;

  try {
    // Run audit to find safe candidates
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
        message: 'No safe patch updates available.',
      });
    }

    // Commit the updated package.json to GitHub → triggers Vercel redeploy
    const result = await commitPackageJsonToGitHub(candidates);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await captureMessage('Safe package updates committed to GitHub', {
      area: 'dependency-audit',
      level: 'info',
      context: {
        userId: auth.userId,
        packages: result.updatedPackages,
        commitSha: result.commitSha,
      },
      fingerprint: ['dependency-audit', 'github-commit'],
    });

    // Invalidate the report cache — next scan will reflect the new versions
    try {
      await invalidateCache('dep-report:all');
      await invalidateCache('dep-report:prod');
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      updated: result.updatedPackages,
      commitSha: result.commitSha,
      message: `${result.updatedPackages.length} package(s) updated in package.json and committed to GitHub. Vercel will redeploy automatically.`,
    });
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
