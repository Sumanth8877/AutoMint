import { getDb } from '@/lib/db';
import { tasks } from '@/drizzle/schema/tasks';
import { sql, eq, and, desc, lt, asc } from 'drizzle-orm';

export type TaskType = 'wallet_monitoring' | 'nft_tracking' | 'collection_sync' | 'metadata_refresh' | 'mint_execution' | 'website_monitoring' | 'browser_automation';
export type TaskStatus = 'pending' | 'running' | 'retrying' | 'completed' | 'failed' | 'dead_letter';

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
const BACKOFF_MINUTES = [0, 1, 5, 15, 60];

/**
 * Calculate the next retry time based on attempt count.
 * Attempt 1 → immediate (0 min), Attempt 2 → 1 min, ...
 */
function getRetryDelay(attempt: number): Date {
  const index = Math.min(attempt - 1, BACKOFF_MINUTES.length - 1);
  const minutes = BACKOFF_MINUTES[index];
  return new Date(Date.now() + minutes * 60 * 1000);
}

// ─── Create ────────────────────────────────────────
export async function createTask(params: CreateTaskParams) {
  const [record] = await getDb().insert(tasks).values({
    userId: params.userId || null,
    taskType: params.taskType as any,
    status: 'pending',
    priority: params.priority ?? 0,
    attempts: 0,
    maxAttempts: params.maxAttempts ?? 5,
    payload: params.payload ? JSON.parse(JSON.stringify(params.payload)) : null,
    scheduledFor: params.scheduledFor || new Date(),
    idempotencyKey: params.idempotencyKey || null,
  }).returning();
  return record;
}

// ─── Update ────────────────────────────────────────
export async function updateTask(id: string, params: UpdateTaskParams) {
  const updateData: Record<string, any> = { updatedAt: new Date() };
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
  const now = new Date();

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
 */
export async function getPendingTasksByType(taskType: TaskType, limit = 10) {
  const now = new Date();
  return getDb().select().from(tasks)
    .where(
      and(
        eq(tasks.taskType, taskType as any),
        eq(tasks.status, 'pending'),
        lt(tasks.scheduledFor ?? sql`NOW()`, sql`NOW()`),
      ),
    )
    .orderBy(asc(tasks.priority), desc(tasks.createdAt))
    .limit(limit);
}

/**
 * Get retrying tasks that are due for retry.
 */
export async function getDueRetryTasks(limit = 10) {
  const now = new Date();
  return getDb().select().from(tasks)
    .where(
      and(
        eq(tasks.status, 'retrying'),
        lt(tasks.scheduledFor ?? sql`NOW()`, sql`NOW()`),
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
