import 'server-only';

import {
  runInfrastructureServiceTests,
  type InfrastructureTestResult,
} from '@/lib/services/infrastructure-test.service';
import { storeInfrastructureTestResults } from '@/lib/services/test-results.service';

export type InfrastructureReadiness =
  | 'Production Ready'
  | 'Mostly Ready'
  | 'Needs Attention'
  | 'Critical Issues';

export type InfrastructureTestRunSummary = {
  overallScore: number;
  readiness: InfrastructureReadiness;
  reasoning: string;
  results: InfrastructureTestResult[];
  testedAt: string;
};

function readinessFor(score: number, results: InfrastructureTestResult[]): InfrastructureReadiness {
  const failed = results.filter((result) => result.status === 'failed').length;
  if (score < 50 || failed >= 3) return 'Critical Issues';
  if (score < 70 || failed > 0) return 'Needs Attention';
  if (score < 90 || results.some((result) => result.status === 'warning')) return 'Mostly Ready';
  return 'Production Ready';
}

function assessmentReasoning(score: number, results: InfrastructureTestResult[]) {
  const failed = results.filter((result) => result.status === 'failed');
  const warnings = results.filter((result) => result.status === 'warning');

  if (failed.length === 0 && warnings.length === 0) {
    return 'All critical infrastructure services completed real validation successfully. No blocking failures were found.';
  }

  const parts: string[] = [];
  if (failed.length > 0) {
    parts.push(`${failed.length} service${failed.length === 1 ? '' : 's'} failed: ${failed.map((result) => result.service).join(', ')}.`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} service${warnings.length === 1 ? '' : 's'} returned warnings: ${warnings.map((result) => result.service).join(', ')}.`);
  }
  parts.push(`Overall infrastructure score is ${score}/100.`);
  return parts.join(' ');
}

export function summarizeInfrastructureTestRun(results: InfrastructureTestResult[]): InfrastructureTestRunSummary {
  const overallScore = results.length > 0
    ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length)
    : 0;
  const readiness = readinessFor(overallScore, results);

  return {
    overallScore,
    readiness,
    reasoning: assessmentReasoning(overallScore, results),
    results,
    testedAt: new Date().toISOString(),
  };
}

export async function runInfrastructureTests() {
  const results = await runInfrastructureServiceTests();
  await storeInfrastructureTestResults(results);
  return summarizeInfrastructureTestRun(results);
}
