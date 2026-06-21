import 'server-only';

import { desc } from 'drizzle-orm';
import { infrastructureTestRuns } from '@/drizzle/schema';
import { getDb } from '@/lib/db';
import type { InfrastructureTestResult } from '@/lib/services/infrastructure-test.service';

export async function storeInfrastructureTestResults(results: InfrastructureTestResult[]) {
  if (results.length === 0) return [];

  return getDb().insert(infrastructureTestRuns).values(results.map((result) => ({
    service: result.service,
    status: result.status,
    score: result.score,
    latency: result.latency,
    summary: result.summary,
    reasoning: result.reasoning,
    rootCause: result.rootCause,
    fixRecommendation: result.fixRecommendation,
    response: result.response,
    testedAt: result.testedAt,
  }))).returning();
}

export async function getInfrastructureTestHistory(limit = 100) {
  return getDb()
    .select()
    .from(infrastructureTestRuns)
    .orderBy(desc(infrastructureTestRuns.testedAt))
    .limit(limit);
}

export async function getLatestInfrastructureTestResults() {
  const rows = await getInfrastructureTestHistory(200);
  const latest = new Map<string, typeof rows[number]>();

  for (const row of rows) {
    if (!latest.has(row.service)) latest.set(row.service, row);
  }

  return Array.from(latest.values()).sort((left, right) => left.service.localeCompare(right.service));
}
