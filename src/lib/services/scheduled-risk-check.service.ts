import 'server-only';

import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { mintTasks } from '@/drizzle/schema';
import { logActivity } from '@/lib/monitoring';
import { analyzeMintRisk } from '@/lib/services/risk.service';
import { isTelegramEnabled } from '@/lib/services/telegram.service';

const RISK_CHANGE_THRESHOLD = 20;

function getRiskDelta(previous: number | null, current: number) {
  return Math.abs(current - (previous ?? current));
}

export async function storeOriginalRiskSnapshot(taskId: string) {
  try {
    const risk = await analyzeMintRisk(taskId);

    await getDb()
      .update(mintTasks)
      .set({
        originalRiskScore: risk.riskScore,
        originalRiskReasons: risk.riskReasons,
        latestRiskScore: risk.riskScore,
        latestRiskReasons: risk.riskReasons,
        updatedAt: new Date(),
      })
      .where(eq(mintTasks.id, taskId));

    return risk;
  } catch (error) {
    throw error;
  }
}

export async function executeScheduledRiskCheck(taskId: string) {
  try {
    const [task] = await getDb().select().from(mintTasks).where(eq(mintTasks.id, taskId)).limit(1);
    if (!task) throw new Error('Mint task not found');

    if (task.overrideRiskFlag) {
      return { continue: true, skipped: true, reason: 'override_enabled' };
    }

    const risk = await analyzeMintRisk(taskId);
    const previousScore = task.originalRiskScore ?? task.riskScore ?? risk.riskScore;
    const delta = getRiskDelta(previousScore, risk.riskScore);

    await getDb()
      .update(mintTasks)
      .set({
        originalRiskScore: task.originalRiskScore ?? task.riskScore ?? risk.riskScore,
        originalRiskReasons: task.originalRiskReasons ?? task.riskReasons ?? risk.riskReasons,
        latestRiskScore: risk.riskScore,
        latestRiskReasons: risk.riskReasons,
        updatedAt: new Date(),
      })
      .where(eq(mintTasks.id, taskId));

    await logActivity(task.userId, 'mint_status_changed', 'Scheduled mint risk re-analysis complete', {
      taskId,
      previousScore,
      latestRiskScore: risk.riskScore,
      delta,
    });

    if (delta >= RISK_CHANGE_THRESHOLD) {
      await getDb()
        .update(mintTasks)
        .set({ safeModeEnabled: true, updatedAt: new Date() })
        .where(eq(mintTasks.id, taskId));

      if (!isTelegramEnabled()) {
        await logActivity(task.userId, 'mint_status_changed', 'Risk change manual approval required', {
          taskId,
          previousScore,
          latestRiskScore: risk.riskScore,
          delta,
          approvalChannel: 'manual_required',
        });

        return {
          continue: false,
          previousScore,
          latestRiskScore: risk.riskScore,
          delta,
          approvalChannel: 'manual_required',
        };
      }

      const { sendTelegramRiskChangePrompt } = await import('@/lib/services/telegram.service');
      await sendTelegramRiskChangePrompt({
        userId: task.userId,
        taskId,
        previousScore,
        currentScore: risk.riskScore,
      });

      return { continue: false, previousScore, latestRiskScore: risk.riskScore, delta };
    }

    return { continue: true, previousScore, latestRiskScore: risk.riskScore, delta };
  } catch (error) {
    throw error;
  }
}

export function hasBlockingRiskChange(task: {
  overrideRiskFlag: boolean;
  originalRiskScore: number | null;
  latestRiskScore: number | null;
}) {
  if (task.overrideRiskFlag) return false;
  if (task.originalRiskScore === null || task.latestRiskScore === null) return false;
  return getRiskDelta(task.originalRiskScore, task.latestRiskScore) >= RISK_CHANGE_THRESHOLD;
}
