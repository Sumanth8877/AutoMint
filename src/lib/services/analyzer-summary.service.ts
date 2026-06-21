import 'server-only';

import type { AnalyzerDebugLogLevel, MintIntent } from '@/lib/resolve-mint-intent';
import type { CollectionMetadata } from '@/lib/blockchain/collections';
import type { MintState } from '@/lib/services/mint-state.service';
import type { MintRequirements } from '@/lib/services/mint-requirements.service';
import type { AnalyzerRiskAnalysis } from '@/lib/services/risk.service';
import type { AnalyzerSocials } from '@/lib/services/analyzer.service';
import type { AnalyzerCollectionIntelligence } from '@/lib/services/analyzer-market-intelligence.service';

export type AnalyzerAiSummary = {
  summary: string;
  projectSummary: string;
  riskSummary: string;
  marketSummary: string;
  mintSummary: string;
};

type SummaryMetadata = Omit<CollectionMetadata, 'totalSupply'> & {
  totalSupply: string;
};

const SUMMARY_UNAVAILABLE = 'Summary unavailable';

function sentence(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function formatChain(chain: string) {
  return chain.charAt(0).toUpperCase() + chain.slice(1);
}

function socialLabels(socials: AnalyzerSocials) {
  const labels = [
    socials.website ? 'website' : null,
    socials.twitter ? 'Twitter/X' : null,
    socials.discord ? 'Discord' : null,
    socials.telegram ? 'Telegram' : null,
    socials.github ? 'GitHub' : null,
    socials.medium ? 'Medium' : null,
  ].filter((value): value is string => Boolean(value));

  if (labels.length === 0) return 'no verified social channels discovered';
  if (labels.length === 1) return `${labels[0]} discovered`;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)} discovered`;
}

function marketSentence(collectionIntelligence: AnalyzerCollectionIntelligence) {
  const parts = [
    collectionIntelligence.floorPrice ? `floor price ${collectionIntelligence.floorPrice}` : null,
    collectionIntelligence.volume ? `volume ${collectionIntelligence.volume}` : null,
    collectionIntelligence.ownerCount ? `${collectionIntelligence.ownerCount.toLocaleString()} owners` : null,
  ].filter(Boolean);
  return parts.length ? `Market data includes ${parts.join(', ')}.` : undefined;
}

function buildProjectSummary(params: {
  intent: MintIntent;
  metadata: SummaryMetadata;
  socials: AnalyzerSocials;
  collectionIntelligence: AnalyzerCollectionIntelligence;
}) {
  const name = params.metadata.name || params.intent.collectionName || params.intent.collectionSlug || 'This collection';
  const standard = params.metadata.tokenStandard !== 'Unknown' ? `${params.metadata.tokenStandard} ` : '';
  const supply = Number(params.metadata.totalSupply);
  const supplyText = Number.isFinite(supply) && supply > 0 ? `with ${supply.toLocaleString()} tokens tracked` : 'with supply not fully reported';
  const description = params.collectionIntelligence.description?.trim();

  return sentence([
    `${name} is a ${standard}NFT collection on ${formatChain(params.intent.chain)} ${supplyText}.`,
    description ? `${description.slice(0, 220)}${description.length > 220 ? '...' : ''}` : null,
    `Social discovery found ${socialLabels(params.socials)}.`,
    marketSentence(params.collectionIntelligence),
  ]);
}

function buildRiskSummary(riskAnalysis: AnalyzerRiskAnalysis, collectionIntelligence: AnalyzerCollectionIntelligence) {
  const factors = riskAnalysis.riskFactors.slice(0, 3);
  const marketContext = [
    collectionIntelligence.verified === false ? 'unverified status' : null,
    !collectionIntelligence.volume ? 'unavailable liquidity' : null,
    collectionIntelligence.ownerCount !== null && collectionIntelligence.itemCount !== null && collectionIntelligence.ownerCount / Math.max(collectionIntelligence.itemCount, 1) < 0.2
      ? 'owner concentration'
      : null,
  ].filter(Boolean);
  if (factors.length === 0) {
    return `Risk is classified as ${riskAnalysis.riskLevel} with a score of ${riskAnalysis.riskScore}; market health is ${collectionIntelligence.healthScore}/100 and no material analyzer risk factors were detected from available signals.`;
  }

  return `Risk is classified as ${riskAnalysis.riskLevel} with a score of ${riskAnalysis.riskScore} due to ${factors.join('; ')}${marketContext.length ? `, with market context including ${marketContext.join(', ')}` : ''}.`;
}

function buildMarketSummary(collectionIntelligence: AnalyzerCollectionIntelligence) {
  const verified = collectionIntelligence.verified === null
    ? 'verification status unavailable'
    : collectionIntelligence.verified
      ? 'verified collection'
      : 'unverified collection';

  return sentence([
    `Market status is ${collectionIntelligence.marketStatus} with health score ${collectionIntelligence.healthScore}/100.`,
    `${verified}.`,
    collectionIntelligence.ownerCount !== null ? `${collectionIntelligence.ownerCount.toLocaleString()} owners are tracked.` : 'Owner count is unavailable.',
    collectionIntelligence.volume ? `Volume is ${collectionIntelligence.volume}.` : 'Volume is unavailable.',
    collectionIntelligence.floorPrice ? `Floor price is ${collectionIntelligence.floorPrice}.` : 'Floor price is unavailable.',
    collectionIntelligence.healthSummary,
  ]);
}

function buildMintSummary(params: {
  metadata: SummaryMetadata;
  mintState: MintState;
  requirements: MintRequirements;
  mintFunction: { functionName: string; confidence: number };
}) {
  const status = params.mintState.status.toLowerCase();
  const confidence = Math.round(params.mintFunction.confidence * 100);
  const standard = params.metadata.tokenStandard !== 'Unknown'
    ? `Contract inspection identified ${params.metadata.tokenStandard} compliance.`
    : 'Contract inspection could not confirm a token standard.';
  const price = params.requirements.mintPrice ? `Mint price is ${params.requirements.mintPrice}.` : 'Mint price is unavailable.';
  const functionText = params.mintFunction.functionName && params.mintFunction.functionName !== 'unknown'
    ? `Mint function ${params.mintFunction.functionName} was detected with ${confidence}% confidence.`
    : 'Mint function detection did not identify a callable mint entrypoint.';

  return sentence([
    `Mint is currently ${status}.`,
    standard,
    functionText,
    price,
  ]);
}

export async function generateAnalyzerAiSummary(params: {
  intent: MintIntent;
  metadata: SummaryMetadata;
  mintState: MintState;
  requirements: MintRequirements;
  mintFunction: { functionName: string; selector: string; confidence: number };
  riskAnalysis: AnalyzerRiskAnalysis;
  socials: AnalyzerSocials;
  collectionIntelligence: AnalyzerCollectionIntelligence;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
}): Promise<AnalyzerAiSummary> {
  try {
    params.log('info', 'ai_summary', 'Generating AI summary');
    params.log('info', 'ai_summary', 'Building project summary');
    const projectSummary = buildProjectSummary(params);

    params.log('info', 'ai_summary', 'Building risk summary');
    const riskSummary = buildRiskSummary(params.riskAnalysis, params.collectionIntelligence);

    const marketSummary = buildMarketSummary(params.collectionIntelligence);

    params.log('info', 'ai_summary', 'Building mint summary');
    const mintSummary = buildMintSummary(params);

    const summary = sentence([projectSummary, riskSummary, marketSummary, mintSummary]);
    params.log('success', 'ai_summary', 'AI summary completed');

    return {
      summary,
      projectSummary,
      riskSummary,
      marketSummary,
      mintSummary,
    };
  } catch (error) {
    params.log('warning', 'ai_summary', `AI summary failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      summary: SUMMARY_UNAVAILABLE,
      projectSummary: SUMMARY_UNAVAILABLE,
      riskSummary: SUMMARY_UNAVAILABLE,
      marketSummary: SUMMARY_UNAVAILABLE,
      mintSummary: SUMMARY_UNAVAILABLE,
    };
  }
}
