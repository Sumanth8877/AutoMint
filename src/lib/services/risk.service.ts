import 'server-only';

import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collections, mintHistory, mintTasks, wallets } from '@/drizzle/schema';
import { logActivity } from '@/lib/monitoring';
import { getMintState } from '@/lib/services/mint-state.service';

const RISK_THRESHOLD = 50;

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
  totalSupply?: string | null;
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
  if (!params.totalSupply) {
    score += addRisk(reasons, 'Collection supply is unavailable', 3);
  }

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

export async function analyzeMintRisk(taskId: string): Promise<RiskAnalysis> {
  const subject = await loadRiskSubject(taskId);
  if (!subject?.task) throw new Error('Mint task not found');

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
    })),
    Promise.resolve(scoreDomainAge(collection?.createdAt ?? task.createdAt)),
  ]);

  const riskScore = clampScore(contract.score + trustedWallet.score + social.score + domainAge.score);
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
    weights: {
      contractAnalysis: contract.score,
      trustedWalletActivity: trustedWallet.score,
      socialAnalysis: social.score,
      domainAge: domainAge.score,
    },
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
}

export function isHighRisk(riskScore: number) {
  return riskScore >= RISK_THRESHOLD;
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

  const risk = await analyzeMintRisk(params.taskId);
  if (!isHighRisk(risk.riskScore)) return { approved: true, risk };

  await getDb()
    .update(mintTasks)
    .set({ safeModeEnabled: true, updatedAt: new Date() })
    .where(eq(mintTasks.id, params.taskId));

  await sendSafeModePrompt({
    taskId: params.taskId,
    userId: task.userId,
    action: params.action,
    risk,
  });

  return { approved: false, risk };
}
