/**
 * GET /api/system/upgrade-report
 *
 * Generate and download a Markdown upgrade report for the current dependency state.
 *
 * Admin-only endpoint. READ-ONLY — never modifies files.
 *
 * Query params:
 *   ?format=markdown   (default) — returns text/markdown attachment
 *   ?format=json       — returns the raw DependencyAuditReport as JSON
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
  runDependencyAudit,
  generateUpgradeReportMarkdown,
} from '@/lib/services/dependency-audit.service';
import { captureException } from '@/lib/observability/sentry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') ?? 'markdown';

  try {
    const report = await runDependencyAudit({ devPackages: true });

    if (format === 'json') {
      return NextResponse.json({ ok: true, report });
    }

    const markdown = generateUpgradeReportMarkdown(report);
    const filename = `automint-upgrade-report-${new Date().toISOString().split('T')[0]}.md`;

    return new NextResponse(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    await captureException(error, {
      area: 'dependency-audit',
      context: { userId: auth.userId, format },
      fingerprint: ['dependency-audit', 'upgrade-report'],
    });
    const message = error instanceof Error ? error.message : 'Report generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
