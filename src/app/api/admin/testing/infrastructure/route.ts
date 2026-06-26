import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { runInfrastructureTests, summarizeInfrastructureTestRun } from '@/lib/services/test-runner.service';
import { getLatestInfrastructureTestResults } from '@/lib/services/test-results.service';
import type {
  InfrastructureService,
  InfrastructureTestResult,
  InfrastructureTestStatus,
} from '@/lib/services/infrastructure-test.service';

function rowToResult(row: Awaited<ReturnType<typeof getLatestInfrastructureTestResults>>[number]): InfrastructureTestResult {
  return {
    service: row.service as InfrastructureService,
    status: row.status as InfrastructureTestStatus,
    score: row.score,
    latency: row.latency,
    summary: row.summary,
    reasoning: row.reasoning,
    rootCause: row.rootCause,
    fixRecommendation: row.fixRecommendation,
    response: row.response ?? {},
    testedAt: row.testedAt,
  };
}

export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const rows = await getLatestInfrastructureTestResults();
  const results = rows.map(rowToResult);
  return NextResponse.json(summarizeInfrastructureTestRun(results));
}

export async function POST() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const rateLimited = await enforceRateLimit(`infrastructure-test-run:${authResult.userId}`, { limit: 1, windowSeconds: 300 });
  if (rateLimited) return rateLimited;

  const summary = await runInfrastructureTests();
  return NextResponse.json(summary);
}
