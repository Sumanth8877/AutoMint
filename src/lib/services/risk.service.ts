import 'server-only';

import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collections, mintHistory, mintTasks, wallets } from '@/drizzle/schema';
import { logActivity } from '@/lib/monitoring';
import { getMintState } from '@/lib/services/mint-state.service';
import { isTelegramEnabled } from '@/lib/services/telegram.service';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { checkTokenSecurity } from '@/lib/services/goplus-security.service';

// Inline fixed-weight scorer — adaptive learning removed
function applyRiskWeights(
  raw: { contractAnalysis: number; trustedWalletActivity: number; socialAnalysis: number; domainAge: number },
  weights: { contractAnalysis: number; trustedWalletActivity: number; socialAnalysis: number; domainAge: number },
): number {
  const total = weights.contractAnalysis + weights.trustedWalletActivity + weights.socialAnalysis + weights.domainAge;
  if (total === 0) return 0;
  return (
    raw.contractAnalysis * weights.contractAnalysis +
    raw.trustedWalletActivity * weights.trustedWalletActivity +
    raw.socialAnalysis * weights.socialAnalysis +
    raw.domainAge * weights.domainAge
  ) / total;
}

const RISK_THRESHOLD = 75;

export type RiskContext = 'live_mint' | 'scheduled_mint';

export type RiskAnalysis = {
  riskScore: number;
  riskReasons: string[];
  safeModeEnabled: boolean;
  weights: {
    contractAnalysis: number;
    trustedWalletActivity: number;
    socialAnalysis: number;
    domainAge: number;
  };
};

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export type AnalyzerRiskAnalysis = {
  riskScore: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
  weights: RiskAnalysis['weights'];
};

export type AnalyzerRiskSocials = {
  website?: string;
  twitter?: string;
  discord?: string;
  telegram?: string;
};

type PromptAction = 'mint' | 'schedule';

async function loadRiskSubject(taskId: string) {
  const [row] = await getDb()
    .select({
      task: mintTasks,
      wallet: wallets,
      collection: collections,
    })
    .from(mintTasks)
    .leftJoin(wallets, eq(mintTasks.walletId, wallets.id))
    .leftJoin(collections, eq(mintTasks.collectionId, collections.id))
    .where(eq(mintTasks.id, taskId))
    .limit(1);

  return row ?? null;
}

function addRisk(reasons: string[], reason: string, points: number) {
  if (points > 0) reasons.push(reason);
  return points;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getRiskLevel(riskScore: number): RiskLevel {
  if (riskScore <= 25) return 'Low';
  if (riskScore <= 50) return 'Medium';
  if (riskScore <= 75) return 'High';
  return 'Critical';
}

async function scoreContractAnalysis(params: {
  contractAddress?: string | null;
  chain?: string | null;
  mintFunction?: string | null;
  mintPrice?: string | null;
}) {
  const reasons: string[] = [];
  let score = 0;

  if (!params.contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(params.contractAddress)) {
    score += addRisk(reasons, 'Missing or invalid contract address', 24);
  }

  if (!params.chain) {
    score += addRisk(reasons, 'Missing chain', 6);
  }

  if (!params.mintPrice) {
    score += addRisk(reasons, 'Mint price is unknown', 4);
  }

  if (!params.mintFunction || params.mintFunction === 'mint') {
    score += addRisk(reasons, 'Mint function has low confidence or default fallback', 3);
  }

  if (params.contractAddress && params.chain) {
    try {
      const mintState = await getMintState(params.contractAddress, params.chain);
      if (mintState.status === 'UNKNOWN') {
        score += addRisk(reasons, 'Mint status is unknown', 7);
      }
      if (mintState.status === 'ENDED') {
        score += addRisk(reasons, 'Mint appears to have ended', 12);
      }
    } catch {
      score += addRisk(reasons, 'Contract mint state could not be verified', 7);
    }

    // GoPlus Security check
    try {
      const goPlusResult = await checkTokenSecurity({
        contractAddress: params.contractAddress,
        chain: params.chain,
      });

      if (goPlusResult) {
        // Add GoPlus risk factors to reasons
        reasons.push(...goPlusResult.riskFactors);

        // Add GoPlus risk score (scaled to fit within contract analysis max of 40)
        const goPlusScore = Math.min(goPlusResult.riskScore * 0.4, 40);
        score += goPlusScore;

        // Fix #3: these were previously ERC-20 token checks (honeypot,
        // cannotBuy/cannotSell, airdrop scam, blacklist) that don't map onto
        // an NFT contract and were effectively always false for real NFT
        // collections. Replaced with the NFT-specific critical checks GoPlus
        // actually reports for NFT contracts via the NFT Security API.
        if (goPlusResult.isMaliciousContract) {
          score = Math.min(score + 30, 40);
          addRisk(reasons, 'GoPlus: NFT contract flagged as malicious', 30);
        }
        if (goPlusResult.selfDestruct) {
          score = Math.min(score + 25, 40);
          addRisk(reasons, 'GoPlus: Contract can self-destruct', 25);
        }
        if (goPlusResult.transferWithoutApproval) {
          score = Math.min(score + 25, 40);
          addRisk(reasons, 'GoPlus: NFTs can be transferred without owner approval', 25);
        }
        if (goPlusResult.privilegedMinting) {
          score = Math.min(score + 15, 40);
          addRisk(reasons, 'GoPlus: Privileged/unrestricted minting detected', 15);
        }
        if (goPlusResult.oversupplyMinting) {
          score = Math.min(score + 15, 40);
          addRisk(reasons, 'GoPlus: Supply cap can be bypassed (oversupply minting)', 15);
        }
      }
    } catch (_error) {
      // GoPlus check failed, but don't fail the entire risk analysis
    }
  }

  return { score: Math.min(score, 40), reasons };
}

async function scoreTrustedWalletActivity(params: {
  userId: string;
  walletId?: string | null;
  collectionId?: string | null;
}) {
  const reasons: string[] = [];

  if (!params.walletId) {
    return {
      score: 30,
      reasons: ['No wallet selected for trusted activity checks'],
    };
  }

  const [walletSuccess] = await getDb()
    .select({ id: mintHistory.id })
    .from(mintHistory)
    .where(and(
      eq(mintHistory.userId, params.userId),
      eq(mintHistory.walletId, params.walletId),
      eq(mintHistory.status, 'confirmed'),
    ))
    .orderBy(desc(mintHistory.createdAt))
    .limit(1);

  const [userSuccess] = await getDb()
    .select({ id: mintHistory.id })
    .from(mintHistory)
    .where(and(
      eq(mintHistory.userId, params.userId),
      eq(mintHistory.status, 'confirmed'),
    ))
    .orderBy(desc(mintHistory.createdAt))
    .limit(1);

  let score = 0;
  if (!walletSuccess) {
    score += addRisk(reasons, 'Selected wallet has no confirmed mint history', 18);
  }
  if (!userSuccess) {
    score += addRisk(reasons, 'User has no confirmed mint history', 8);
  }

  if (params.collectionId) {
    const [collectionSuccess] = await getDb()
      .select({ id: mintHistory.id })
      .from(mintHistory)
      .where(and(
        eq(mintHistory.userId, params.userId),
        eq(mintHistory.collectionId, params.collectionId),
        eq(mintHistory.status, 'confirmed'),
      ))
      .limit(1);

    if (!collectionSuccess) {
      score += addRisk(reasons, 'No prior confirmed mint for this collection', 4);
    }
  }

  return { score: Math.min(score, 30), reasons };
}

function scoreSocialAnalysis(params: {
  collectionName?: string | null;
  owner?: string | null;
  tokenStandard?: string | null;
  floorPrice?: string | null;
  volume?: string | null;
  ownerCount?: number | null;
  verifiedStatus?: boolean | null;
  totalSupply?: string | null;
  socials?: AnalyzerRiskSocials;
}) {
  const reasons: string[] = [];
  let score = 0;

  if (!params.collectionName) {
    score += addRisk(reasons, 'Collection name is missing', 5);
  }
  if (!params.owner) {
    score += addRisk(reasons, 'Collection owner is unknown', 5);
  }
  if (!params.tokenStandard) {
    score += addRisk(reasons, 'Token standard is unknown', 4);
  }
  if (!params.floorPrice) {
    score += addRisk(reasons, 'Collection floor price is unavailable', 3);
  }
  if (!params.volume) {
    score += addRisk(reasons, 'Collection volume is unavailable', 3);
  }
  if (params.ownerCount === null || params.ownerCount === undefined) {
    score += addRisk(reasons, 'Owner count is unavailable', 3);
  } else if (params.ownerCount < 100) {
    score += addRisk(reasons, 'Owner count is low', 4);
  }
  if (params.verifiedStatus === false) {
    score += addRisk(reasons, 'Collection is not verified', 5);
  }
  if (!params.totalSupply) {
    score += addRisk(reasons, 'Collection supply is unavailable', 3);
  }
  // Social-link penalties removed — social discovery is no longer part of the
  // pipeline. Legitimacy is now judged purely on on-chain + collection signals
  // (name, owner, token standard, floor, volume, holders, verification, supply).

  return { score: Math.min(score, 20), reasons };
}

function scoreDomainAge(createdAt?: Date | null) {
  if (!createdAt) {
    return { score: 10, reasons: ['Collection discovery age is unknown'] };
  }

  const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000;
  if (ageDays < 1) return { score: 10, reasons: ['Collection was added less than 1 day ago'] };
  if (ageDays < 7) return { score: 6, reasons: ['Collection was added less than 7 days ago'] };
  if (ageDays < 30) return { score: 3, reasons: ['Collection was added less than 30 days ago'] };
  return { score: 0, reasons: [] };
}

export async function analyzeAnalyzerRisk(params: {
  userId: string;
  contractAddress?: string | null;
  chain?: string | null;
  mintFunction?: string | null;
  mintPrice?: string | null;
  collectionName?: string | null;
  owner?: string | null;
  tokenStandard?: string | null;
  floorPrice?: string | null;
  volume?: string | null;
  ownerCount?: number | null;
  verifiedStatus?: boolean | null;
  totalSupply?: string | null;
  socials?: AnalyzerRiskSocials;
  discoveredAt?: Date | null;
}): Promise<AnalyzerRiskAnalysis> {
  const [contract, trustedWallet, social, domainAge] = await Promise.all([
    scoreContractAnalysis({
      contractAddress: params.contractAddress,
      chain: params.chain,
      mintFunction: params.mintFunction,
      mintPrice: params.mintPrice,
    }),
    scoreTrustedWalletActivity({
      userId: params.userId,
      walletId: null,
      collectionId: null,
    }),
    Promise.resolve(scoreSocialAnalysis({
      collectionName: params.collectionName,
      owner: params.owner,
      tokenStandard: params.tokenStandard,
      floorPrice: params.floorPrice,
      volume: params.volume,
      ownerCount: params.ownerCount,
      verifiedStatus: params.verifiedStatus,
      totalSupply: params.totalSupply,
      socials: params.socials,
    })),
    Promise.resolve(scoreDomainAge(params.discoveredAt)),
  ]);

  const rawWeights = {
    contractAnalysis: contract.score,
    trustedWalletActivity: trustedWallet.score,
    socialAnalysis: social.score,
    domainAge: domainAge.score,
  };
  // Fixed equal weights — adaptive learning removed
  const configuredWeights = { contractAnalysis: 1, trustedWalletActivity: 1, socialAnalysis: 1, domainAge: 1 };
  const riskScore = clampScore(applyRiskWeights(rawWeights, configuredWeights));
  const riskFactors = [
    ...contract.reasons,
    ...trustedWallet.reasons,
    ...social.reasons,
    ...domainAge.reasons,
  ];

  return {
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    riskFactors,
    weights: rawWeights,
  };
}

export async function analyzeMintRisk(taskId: string): Promise<RiskAnalysis> {
  return (async () => {
  const subject = await loadRiskSubject(taskId);
  if (!subject?.task) throw new Error('Mint task not found');

  // Fix #11: respect the riskAnalysisEnabled toggle. When the user disables
  // risk analysis in settings, skip the scoring and return a safe result so
  // mints proceed without a risk gate.
  const execDefaults = await getEffectiveExecutionDefaults(subject.task.userId);
  if (!execDefaults.riskAnalysisEnabled) {
    return {
      riskScore: 0,
      riskReasons: ['Risk analysis disabled by user'],
      safeModeEnabled: false,
      weights: { contractAnalysis: 0, trustedWalletActivity: 0, socialAnalysis: 0, domainAge: 0 },
    };
  }

  const { task, wallet, collection } = subject;
  const [contract, trustedWallet, social, domainAge] = await Promise.all([
    scoreContractAnalysis({
      contractAddress: task.contractAddress,
      chain: wallet?.chain ?? collection?.chain,
      mintFunction: task.mintFunction,
      mintPrice: task.mintPrice,
    }),
    scoreTrustedWalletActivity({
      userId: task.userId,
      walletId: task.walletId,
      collectionId: task.collectionId,
    }),
    Promise.resolve(scoreSocialAnalysis({
      collectionName: collection?.name,
      owner: collection?.owner,
      tokenStandard: collection?.tokenStandard,
      floorPrice: collection?.floorPrice,
      totalSupply: collection?.totalSupply,
      socials: undefined,
    })),
    Promise.resolve(scoreDomainAge(collection?.createdAt ?? task.createdAt)),
  ]);

  const rawWeights = {
    contractAnalysis: contract.score,
    trustedWalletActivity: trustedWallet.score,
    socialAnalysis: social.score,
    domainAge: domainAge.score,
  };
  // Fixed equal weights — adaptive learning removed
  const configuredWeights = { contractAnalysis: 1, trustedWalletActivity: 1, socialAnalysis: 1, domainAge: 1 };
  const riskScore = clampScore(applyRiskWeights(rawWeights, configuredWeights));
  const riskReasons = [
    ...contract.reasons,
    ...trustedWallet.reasons,
    ...social.reasons,
    ...domainAge.reasons,
  ];

  const analysis = {
    riskScore,
    riskReasons,
    safeModeEnabled: task.safeModeEnabled,
    weights: rawWeights,
  };

  await getDb()
    .update(mintTasks)
    .set({
      riskScore,
      riskReasons,
      updatedAt: new Date(),
    })
    .where(eq(mintTasks.id, taskId));

  await logActivity(task.userId, 'mint_status_changed', 'Risk analysis complete', {
    taskId,
    riskScore,
    riskReasons,
    weights: analysis.weights,
  });

  return analysis;
  })().catch(async (error: unknown) => {
    throw error;
  });
}

export function isHighRisk(riskScore: number, threshold = RISK_THRESHOLD) {
  return riskScore > threshold;
}

export async function sendSafeModePrompt(params: {
  taskId: string;
  userId: string;
  action: PromptAction;
  risk: RiskAnalysis;
}) {
  const { sendTelegramSafeModePrompt } = await import('@/lib/services/telegram.service');
  await sendTelegramSafeModePrompt({
    userId: params.userId,
    taskId: params.taskId,
    action: params.action,
    riskScore: params.risk.riskScore,
    riskReasons: params.risk.riskReasons,
  });

  await logActivity(params.userId, 'mint_status_changed', 'Safe mode approval requested', {
    taskId: params.taskId,
    action: params.action,
    riskScore: params.risk.riskScore,
    riskReasons: params.risk.riskReasons,
  });
}

export async function requireRiskApproval(params: {
  taskId: string;
  action: PromptAction;
  userId?: string;
}) {
  const [task] = await getDb().select().from(mintTasks).where(eq(mintTasks.id, params.taskId)).limit(1);
  if (!task) throw new Error('Mint task not found');
  if (params.userId && task.userId !== params.userId) throw new Error('Mint task not found');
  if (task.overrideRiskFlag) return { approved: true, risk: null };

  const storedRisk = typeof task.riskScore === 'number'
    ? {
        riskScore: task.riskScore,
        riskReasons: task.riskReasons ?? [],
        safeModeEnabled: task.safeModeEnabled,
        weights: {
          contractAnalysis: 0,
          trustedWalletActivity: 0,
          socialAnalysis: 0,
          domainAge: 0,
        },
      }
    : null;

  if (params.action === 'mint' && !storedRisk) {
    return { approved: true, risk: null };
  }

  const risk = storedRisk ?? await analyzeMintRisk(params.taskId);
  if (!isHighRisk(risk.riskScore, task.riskThreshold)) return { approved: true, risk };

  await getDb()
    .update(mintTasks)
    .set({ safeModeEnabled: true, updatedAt: new Date() })
    .where(eq(mintTasks.id, params.taskId));

  if (!isTelegramEnabled()) {
    await logActivity(task.userId, 'mint_status_changed', 'Safe mode manual approval required', {
      taskId: params.taskId,
      action: params.action,
      riskScore: risk.riskScore,
      riskReasons: risk.riskReasons,
      approvalChannel: 'manual_required',
    });

    return { approved: false, risk, approvalChannel: 'manual_required' };
  }

  await sendSafeModePrompt({
    taskId: params.taskId,
    userId: task.userId,
    action: params.action,
    risk,
  });

  return { approved: false, risk };
}
