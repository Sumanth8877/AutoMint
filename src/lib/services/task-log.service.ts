import 'server-only';
import { getDb } from '@/lib/db';
import { taskLogs } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

export type TaskLogEvent =
  | 'task_created'
  | 'risk_check_started' | 'risk_check_passed' | 'risk_check_blocked'
  | 'balance_check_started' | 'balance_check_passed' | 'balance_check_failed'
  | 'mint_state_check' | 'mint_state_live' | 'mint_state_not_started' | 'mint_state_ended'
  | 'qstash_published' | 'qstash_received'
  | 'websocket_monitoring' | 'websocket_live_detected' | 'websocket_timeout'
  | 'price_refetch' | 'price_changed'
  | 'honeypot_check_started' | 'honeypot_check_passed' | 'honeypot_check_failed'
  | 'tx_submitting' | 'tx_submitted' | 'tx_confirmed' | 'tx_failed' | 'tx_reverted'
  | 'task_completed' | 'task_failed' | 'task_cancelled' | 'task_retrying'
  | 'monitoring_started' | 'monitoring_rescheduled';

export async function addTaskLog(
  taskId: string,
  event: TaskLogEvent,
  status: 'info' | 'success' | 'warning' | 'error',
  message: string,
) {
  try {
    await getDb().insert(taskLogs).values({ taskId, event, status, message });
  } catch {
    // Non-fatal: logging must never block execution
  }
}

export async function getTaskLogs(taskId: string, limit = 100) {
  return getDb()
    .select()
    .from(taskLogs)
    .where(eq(taskLogs.taskId, taskId))
    .orderBy(desc(taskLogs.createdAt))
    .limit(limit);
}
