import { pgTable, text, timestamp, uuid, integer, jsonb, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './index';
import { relations } from 'drizzle-orm';

// ─── Task Type Enum ──────────────────────────────
export const taskTypeEnum = pgEnum('task_type', [
  'wallet_monitoring',
  'nft_tracking',
  'collection_sync',
  'metadata_refresh',
  'mint_execution',
  'website_monitoring',
  'browser_automation',
]);

// ─── Task Status Enum ────────────────────────────
export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'running',
  'retrying',
  'completed',
  'failed',
  'dead_letter',
]);

// ─── Background Tasks Table ─────────────────────────
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  taskType: taskTypeEnum('task_type').notNull(),
  status: taskStatusEnum('status').default('pending').notNull(),
  priority: integer('priority').default(0).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),

  // Payload / Result / Error as JSONB
  payload: jsonb('payload'),
  result: jsonb('result'),
  error: jsonb('error'),

  // Scheduling
  scheduledFor: timestamp('scheduled_for'),

  // Idempotency (mint execution safety)
  idempotencyKey: text('idempotency_key'),
  txHash: text('tx_hash'),
  executionFingerprint: text('execution_fingerprint'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  // Indexes for efficient queue-like access
  pendingTasksIdx: index('idx_tasks_status_type_scheduled')
    .on(table.status, table.taskType, table.scheduledFor),
  userIdIdx: index('idx_tasks_user_id').on(table.userId),
  idempotencyIdx: uniqueIndex('idx_tasks_idempotency_key').on(table.idempotencyKey),
  deadLetterIdx: index('idx_tasks_dead_letter')
    .on(table.status)
    .where(sql`status = 'dead_letter'`),
  priorityIdx: index('idx_tasks_priority')
    .on(table.priority, table.createdAt),
}));

// ─── Relations ───────────────────────────────────────
export const tasksRelations = relations(tasks, ({ one }) => ({
  user: one(users, { fields: [tasks.userId], references: [users.id] }),
}));