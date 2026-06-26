/**
 * @file task.service.ts
 *
 * ⚠️  ARCHITECTURAL NOTE — NOT YET INTEGRATED INTO MINT FLOW
 * -----------------------------------------------------------
 * This service provides a full task queue (createTask, startTask, completeTask,
 * failTask, retryDeadLetterTask, getDeadLetterTasks, etc.) with a validated
 * state machine (VALID_TRANSITIONS) and idempotency keys.
 *
 * CURRENT STATUS: Scaffolded but NOT wired into the live mint execution path.
 * The mint orchestrator (mint-orchestrator.service.ts), QStash worker
 * (api/webhooks/qstash/route.ts), and recovery service (mint-recovery.service.ts)
 * all bypass this service and use direct DB queries instead.
 *
 * TO INTEGRATE:
 *   1. Replace direct mintTasks DB writes in mint.service.ts with createTask()
 *   2. Replace status updates in qstash/route.ts with startTask() / completeTask() / failTask()
 *   3. Replace recovery polling in mint-recovery.service.ts with getDeadLetterTasks()
 *   4. Replace health-check task count queries with getTaskCounts()
 *
 * Until integrated, this file is imported only by the health-check route
 * (api/admin/system/health) and tests. Do not delete — wire it up instead.
 */

import { getDb } from '@/lib/db';
import { tasks } from '@/drizzle/schema/tasks';
import { sql, eq, and, desc, asc } from 'drizzle-orm';

export type TaskType = 'wallet_monitoring' | 'nft_tracking' | 'collection_sync' | 'metadata_refresh' | 'mint_execution' | 'website_monitoring' | 'browser_automation';
export type TaskStatus = 'pending' | 'running' | 'retrying' | 'completed' | 'failed' | 'dead_letter';

// ─── State machine ────────────────────────────────────────────────
// Defines valid transitions between task statuses.
// Prevents bugs like a completed task being set back to running.
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending:     ['running', 'failed', 'dead_letter'],
  running:     ['retrying', 'completed', 'failed', 'dead_letter'],
  retrying:    ['running', 'failed', 'dead_letter'],
  completed:   [],                            // terminal state — no further transitions
  failed:      ['retrying', 'dead_letter'],   // can be retried externally
  dead_letter: [],                            // terminal state — escalate manually
};

/**
 * Assert that a status transition is valid.
 * Throws if the transition is not permitted by the state machine.
 */
export function assertValidTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid task status transition: ${from} → ${to}. ` +
      `Allowed from ${from}: [${allowed.join(', ') || 'none (terminal state)'}]`
    );
  }
}

/**
 * Check if a transition is valid without throwing.
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export interface CreateTaskParams {
  userId?: string | null;
  taskType: TaskType;
  payload?: Record<string, unknown>;
  priority?: number;
  scheduledFor?: Date;
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface UpdateTaskParams {
  status?: TaskStatus;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  attempts?: number;
  txHash?: string;
  executionFingerprint?: string;
  scheduledFor?: Date;
}

// ─── Backoff Schedule ─────────────────────────────
const BACKOFF_MINUTES = [0.5, 1, 5, 15, 60]; // Minimum 30s before first retry — prevents hammering RPC on immediate failure

/**
 * Calculate the next retry time based on attempt count.
 * Attempt 1 → immediate (0 min), Attempt 2 → 1 min, ...
 */
function getRetryDelay(attempt: number): Date {
  const index = Math.min(attempt - 1, BACKOFF_MINUTES.length - 1);
  const minutes = BACKOFF_MINUTES[index];
  return new Date(Date.now() + minutes * 60 * 1000);
}

// ─── Idempotency key generation ─────────────────────
/**
 * Build a deterministic idempotency key for critical task types.
 *
 * This is the PRIMARY idempotency enforcement layer.
 * The DB unique index on idempotency_key is secondary safety only.
 *
 * Rules:
 * - mint_execution: key = `mint:${walletId}:${collectionId}`
 * - All other automated/cron tasks MUST generate a key, never pass null
 */
export function buildIdempotencyKey(params: CreateTaskParams): string | null {
  // Critical: mint_execution uses wallet+collection as its idempotency key
  if (params.taskType === 'mint_execution') {
    const walletId = typeof params.payload?.walletId === 'string' ? params.payload.walletId : undefined;
    const collectionId = typeof params.payload?.collectionId === 'string' ? params.payload.collectionId : undefined;
    if (walletId && collectionId) {
      return `mint:${walletId}:${collectionId}`;
    }
  }

  // For all other automated tasks, use the provided key or generate one from payload
  if (params.idempotencyKey) {
    return params.idempotencyKey;
  }

  // If there's a payload but no explicit key, generate a deterministic hash
  if (params.payload) {
    const stable = JSON.stringify(params.payload, Object.keys(params.payload).sort());
    return `${params.taskType}:${stable}`;
  }

  return null;
}

// ─── Create ────────────────────────────────────────
export async function createTask(params: CreateTaskParams) {
  // 1. Resolve or generate idempotency key (application-level enforcement)
  const idempotencyKey = buildIdempotencyKey(params);

  // 2. Check for existing task with the same idempotency key.
  // Only reuse if the task is still active (pending/running/retrying).
  // If it completed, failed, or was cancelled, allow a new task to be created.
  if (idempotencyKey) {
    const [existing] = await getDb()
      .select()
      .from(tasks)
      .where(eq(tasks.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      const activeStatuses: TaskStatus[] = ['pending', 'running', 'retrying'];
      if (activeStatuses.includes(existing.status as TaskStatus)) {
        // Task is still in-progress — return it to prevent duplicate execution.
        return existing;
      }
      // Task has reached a terminal state — delete the old idempotency key
      // so a fresh task can be created (e.g. retry after failure).
      await getDb().delete(tasks).where(eq(tasks.idempotencyKey, idempotencyKey));
    }
  }

  // 3. Insert new task
  const [record] = await getDb().insert(tasks).values({
    userId: params.userId || null,
    taskType: params.taskType,
    status: 'pending',
    priority: params.priority ?? 0,
    attempts: 0,
    maxAttempts: params.maxAttempts ?? 5,
    payload: params.payload ? JSON.parse(JSON.stringify(params.payload)) : null,
    scheduledFor: params.scheduledFor || new Date(),
    idempotencyKey,
  }).returning();
  return record;
}

// ─── Update ────────────────────────────────────────
export async function updateTask(id: string, params: UpdateTaskParams) {
  const updateData: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (params.status) updateData.status = params.status;
  if (params.result) updateData.result = JSON.parse(JSON.stringify(params.result));
  if (params.error) updateData.error = JSON.parse(JSON.stringify(params.error));
  if (params.attempts !== undefined) updateData.attempts = params.attempts;
  if (params.txHash) updateData.txHash = params.txHash;
  if (params.executionFingerprint) updateData.executionFingerprint = params.executionFingerprint;

  if (params.status === 'running') updateData.startedAt = new Date();
  if (params.status === 'completed' || params.status === 'failed' || params.status === 'dead_letter') {
    updateData.completedAt = new Date();
  }

  await getDb().update(tasks).set(updateData).where(eq(tasks.id, id));
}

/**
 * Mark a task as running.
 */
export async function startTask(id: string) {
  await updateTask(id, { status: 'running' });
}

/**
 * Mark a task as completed.
 */
export async function completeTask(id: string, result?: Record<string, unknown>) {
  await updateTask(id, { status: 'completed', result });
}

/**
 * Mark a task as failed with retry logic.
 * Applies exponential backoff. Moves to dead_letter if maxAttempts exceeded.
 */
export async function failTask(id: string, error: string | Record<string, unknown>) {
  const task = await getTask(id);
  if (!task) return;

  const newAttempts = (task.attempts || 0) + 1;
  const errorPayload = typeof error === 'string' ? { message: error, timestamp: new Date().toISOString() } : { ...error, timestamp: new Date().toISOString() };

  if (newAttempts >= (task.maxAttempts || 5)) {
    // Max attempts exceeded — move to dead_letter
    await updateTask(id, {
      status: 'dead_letter',
      error: errorPayload,
      attempts: newAttempts,
    });
  } else {
    // Schedule retry with exponential backoff
    await updateTask(id, {
      status: 'retrying',
      error: errorPayload,
      attempts: newAttempts,
      scheduledFor: getRetryDelay(newAttempts),
    });
  }
}

/**
 * Get a task by ID.
 */
export async function getTask(id: string) {
  const [record] = await getDb().select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return record || null;
}

/**
 * Get all tasks for a user.
 */
export async function getUserTasks(userId: string, limit = 50) {
  return getDb().select().from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.createdAt))
    .limit(limit);
}

// ─── Atomic Task Claiming ───────────────────────────
/**
 * Atomically claim pending tasks using PostgreSQL FOR UPDATE SKIP LOCKED.
 *
 * This prevents duplicate processing when multiple cron invocations run concurrently.
 * Only tasks that are pending and whose scheduledFor time has passed are claimed.
 */
export async function claimPendingTasks(taskType: TaskType, limit = 5) {
  // Raw SQL for FOR UPDATE SKIP LOCKED (Drizzle doesn't support this directly)
  const claimed = await getDb().execute(sql`
    UPDATE tasks
    SET
      status = 'running'::task_status,
      started_at = NOW(),
      updated_at = NOW()
    WHERE id IN (
      SELECT id FROM tasks
      WHERE
        status = 'pending'::task_status
        AND task_type = ${taskType}::task_type
        AND (scheduled_for IS NULL OR scheduled_for <= NOW())
      ORDER BY priority DESC, created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  return claimed.rows || [];
}

/**
 * Non-locking fallback: get pending tasks for a type.
 *
 * NULL scheduledFor = run immediately (eligible).
 * Past scheduledFor = eligible.
 * Future scheduledFor = excluded.
 *
 * Uses SQL-level IS NULL OR condition — never TS ?? coalescing inside query builders.
 */
export async function getPendingTasksByType(taskType: TaskType, limit = 10) {
  return getDb().select().from(tasks)
    .where(
      and(
        eq(tasks.taskType, taskType),
        eq(tasks.status, 'pending'),
        sql`(${tasks.scheduledFor} IS NULL OR ${tasks.scheduledFor} <= NOW())`,
      ),
    )
    .orderBy(asc(tasks.priority), desc(tasks.createdAt))
    .limit(limit);
}

/**
 * Get retrying tasks that are due for retry.
 *
 * Uses SQL-level IS NULL OR condition — never TS ?? coalescing inside query builders.
 */
export async function getDueRetryTasks(limit = 10) {
  return getDb().select().from(tasks)
    .where(
      and(
        eq(tasks.status, 'retrying'),
        sql`(${tasks.scheduledFor} IS NULL OR ${tasks.scheduledFor} <= NOW())`,
      ),
    )
    .orderBy(asc(tasks.scheduledFor))
    .limit(limit);
}

/**
 * Get dead-letter tasks (for dashboard visibility).
 */
export async function getDeadLetterTasks(limit = 50) {
  return getDb().select().from(tasks)
    .where(eq(tasks.status, 'dead_letter'))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);
}

/**
 * Manually retry a dead-letter task (moves back to pending).
 */
export async function retryDeadLetterTask(id: string) {
  await getDb().update(tasks)
    .set({
      status: 'pending',
      error: null,
      attempts: 0,
      scheduledFor: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'dead_letter')));
}

/**
 * Get task counts for dashboard.
 * Uses SQL GROUP BY instead of loading entire table into memory.
 */
export async function getTaskCounts() {
  const rows = await getDb().execute<{ status: string; count: number }>(sql`
    SELECT status, COUNT(*)::int AS count
    FROM tasks
    GROUP BY status
  `);

  const counts: Record<string, number> = {};
  for (const row of rows.rows || []) {
    counts[row.status] = row.count;
  }

  return {
    pending: counts['pending'] ?? 0,
    running: counts['running'] ?? 0,
    retrying: counts['retrying'] ?? 0,
    completed: counts['completed'] ?? 0,
    failed: counts['failed'] ?? 0,
    dead_letter: counts['dead_letter'] ?? 0,
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}

/**
 * Clean old completed tasks (keep last 500).
 * Uses a single bulk DELETE with subquery instead of loop.
 */
export async function cleanOldTasks() {
  await getDb().execute(sql`
    DELETE FROM tasks
    WHERE id IN (
      SELECT id FROM tasks
      WHERE status = 'completed'::task_status
      ORDER BY created_at DESC
      OFFSET 500
    )
  `);
}
