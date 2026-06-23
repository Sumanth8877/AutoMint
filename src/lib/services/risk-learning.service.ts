import 'server-only';

import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collectionOutcomes, consensusEvents, riskWeightPerformance } from '@/drizzle/schema';
import { captureException, captureMessage } from '@/lib/observability/sentry';
import { updateWalletReputation } from '@/lib/services/wallet-reputation.service';

export type CollectionOutcome = 'successful' | 'abandoned' | 'suspicious' | 'rug';

type OutcomeInput = {
  contract: string;
  collectionName?: string | null;
  originalRiskScore: number;
  outcome: CollectionOutcome;
  discoveredAt?: Date;
};

type RiskWeights = {
  contractAnalysis: number;
  trustedWalletActivity: number;
  socialAnalysis: number;
  domainAge: number;
};

const DEFAULT_WEIGHTS: RiskWeights = {
  contractAnalysis: 40,
  trustedWalletActivity: 30,
  socialAnalysis: 20,
  domainAge: 10,
};

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

function isValidAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function clampPercent(value: number, fallback: number) {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.round(value);
}

function envWeight(name: string, fallback: number) {
  return clampPercent(Number(process.env[name] ?? fallback), fallback);
}

function isBadOutcome(outcome: CollectionOutcome) {
  return outcome === 'abandoned' || outcome === 'suspicious' || outcome === 'rug';
}

function predictedHighRisk(score: number) {
  return score >= 50;
}

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Returns the current risk weights for scoring.
 * Weights are configured via environment variables (RISK_WEIGHT_CONTRACT etc.)
 * or fall back to defaults.
 *
 * NOTE: Despite the previous name "getAdaptiveRiskWeights", these weights
 * are currently STATIC (env-var driven). The learning infrastructure
 * (collection_outcomes, risk_weight_performance tables) exists but is not
 * yet wired into weight computation. When the learning loop is complete,
 * this function will query the DB for performance-adjusted weights.
 */
export async function getRiskWeights(): Promise<RiskWeights> {
  return {
    contractAnalysis: envWeight('RISK_WEIGHT_CONTRACT', DEFAULT_WEIGHTS.contractAnalysis),
    trustedWalletActivity: envWeight('RISK_WEIGHT_WALLET', DEFAULT_WEIGHTS.trustedWalletActivity),
    socialAnalysis: envWeight('RISK_WEIGHT_SOCIAL', DEFAULT_WEIGHTS.socialAnalysis),
    domainAge: envWeight('RISK_WEIGHT_DOMAIN', DEFAULT_WEIGHTS.domainAge),
  };
}

export function applyRiskWeights(scores: RiskWeights, weights: RiskWeights) {
  return Math.max(0, Math.min(100, Math.round(
    (scores.contractAnalysis / DEFAULT_WEIGHTS.contractAnalysis) * weights.contractAnalysis
    + (scores.trustedWalletActivity / DEFAULT_WEIGHTS.trustedWalletActivity) * weights.trustedWalletActivity
    + (scores.socialAnalysis / DEFAULT_WEIGHTS.socialAnalysis) * weights.socialAnalysis
    + (scores.domainAge / DEFAULT_WEIGHTS.domainAge) * weights.domainAge,
  )));
}

export async function recordCollectionOutcome(input: OutcomeInput) {
  try {
    const contract = normalizeAddress(input.contract);
    if (!isValidAddress(contract)) throw new Error('Invalid contract address');

    const [outcome] = await getDb()
      .insert(collectionOutcomes)
      .values({
        contract,
        collectionName: input.collectionName ?? null,
        originalRiskScore: input.originalRiskScore,
        outcome: input.outcome,
        discoveredAt: input.discoveredAt ?? new Date(),
        evaluatedAt: new Date(),
      })
      .returning();

    const events = await getDb()
      .select()
      .from(consensusEvents)
      .where(eq(consensusEvents.collection, contract));

    await Promise.all(events.map((event) => updateWalletReputation({
      walletAddress: event.walletAddress,
      outcome: input.outcome === 'successful' ? 'successful' : input.outcome === 'rug' ? 'rug' : 'failed',
      metadata: { contract, collectionName: input.collectionName, outcome: input.outcome },
    })));

    await storeCurrentWeightPerformance();
    await alertOnAccuracyDrop();

    return outcome;
  } catch (error) {
    await captureException(error, {
      area: 'risk-learning',
      context: { collection: input.contract },
      extra: { outcome: input.outcome, originalRiskScore: input.originalRiskScore },
      fingerprint: ['risk-learning', 'outcome-processing'],
    });
    throw error;
  }
}

export async function getRiskLearningMetrics() {
  try {
    const outcomes = await getDb().select().from(collectionOutcomes);
    const total = outcomes.length;
    const correct = outcomes.filter((row) => predictedHighRisk(row.originalRiskScore) === isBadOutcome(row.outcome as CollectionOutcome)).length;
    const falsePositives = outcomes.filter((row) => predictedHighRisk(row.originalRiskScore) && row.outcome === 'successful').length;
    const falseNegatives = outcomes.filter((row) => !predictedHighRisk(row.originalRiskScore) && isBadOutcome(row.outcome as CollectionOutcome)).length;
    const predictionAccuracy = percent(correct, total);
    const riskEngineConfidence = Math.max(0, Math.min(100, Math.round(predictionAccuracy - percent(falseNegatives, total) / 2)));

    const consensusRows = await getDb()
      .select({
        total: sql<number>`count(*)`,
        successful: sql<number>`sum(case when ${collectionOutcomes.outcome} = 'successful' then 1 else 0 end)`,
      })
      .from(collectionOutcomes)
      .where(sql`exists (select 1 from consensus_events where consensus_events.collection = ${collectionOutcomes.contract})`);

    const consensusTotal = Number(consensusRows[0]?.total ?? 0);
    const consensusSuccessful = Number(consensusRows[0]?.successful ?? 0);

    return {
      predictionAccuracy,
      riskEngineConfidence,
      whaleConsensusAccuracy: percent(consensusSuccessful, consensusTotal),
      falsePositives,
      falseNegatives,
      totalOutcomes: total,
      scoreDistribution: [
        { label: '0-24', value: outcomes.filter((row) => row.originalRiskScore < 25).length },
        { label: '25-49', value: outcomes.filter((row) => row.originalRiskScore >= 25 && row.originalRiskScore < 50).length },
        { label: '50-74', value: outcomes.filter((row) => row.originalRiskScore >= 50 && row.originalRiskScore < 75).length },
        { label: '75-100', value: outcomes.filter((row) => row.originalRiskScore >= 75).length },
      ],
    };
  } catch (error) {
    await captureException(error, {
      area: 'risk-learning',
      fingerprint: ['risk-learning', 'metrics'],
    });
    throw error;
  }
}

export async function storeCurrentWeightPerformance() {
  const weights = await getAdaptiveRiskWeights();
  const metrics = await getRiskLearningMetrics();

  await getDb().insert(riskWeightPerformance).values({
    contractWeight: weights.contractAnalysis,
    walletWeight: weights.trustedWalletActivity,
    socialWeight: weights.socialAnalysis,
    domainWeight: weights.domainAge,
    predictionAccuracy: Math.round(metrics.predictionAccuracy),
    falsePositives: metrics.falsePositives,
    falseNegatives: metrics.falseNegatives,
    evaluatedAt: new Date(),
  });
}

export async function getRiskWeightHistory(limit = 20) {
  return getDb()
    .select()
    .from(riskWeightPerformance)
    .orderBy(desc(riskWeightPerformance.evaluatedAt))
    .limit(limit);
}

export async function alertOnAccuracyDrop(threshold = 60) {
  const metrics = await getRiskLearningMetrics();
  if (metrics.totalOutcomes < 5 || metrics.predictionAccuracy >= threshold) return { alerted: false };

  await captureMessage('Risk prediction accuracy dropped', {
    area: 'risk-learning',
    level: 'warning',
    extra: metrics,
    fingerprint: ['risk-learning', 'accuracy-drop'],
  });

  const { sendAdminTelegramAlert } = await import('@/lib/services/telegram.service');
  await sendAdminTelegramAlert([
    'Risk prediction accuracy dropped',
    `Accuracy: ${metrics.predictionAccuracy}%`,
    `False positives: ${metrics.falsePositives}`,
    `False negatives: ${metrics.falseNegatives}`,
  ].join('\n'));

  return { alerted: true, metrics };
}
