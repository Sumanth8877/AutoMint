import { pgTable, text, timestamp, uuid, boolean, integer, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './index';
import { tasks } from './tasks';
import { relations } from 'drizzle-orm';

// ─── Website Type Enum ───────────────────────────
export const websiteTypeEnum = pgEnum('website_type', [
  'mint_page',
  'project_site',
  'launchpad',
  'whitelist_page',
  'marketplace',
  'other',
]);

// ─── Website Status Enum ─────────────────────────
export const websiteStatusEnum = pgEnum('website_status', [
  'unknown',
  'no_change',
  'changed',
  'mint_active',
  'mint_ended',
  'error',
]);

// ─── Monitored Websites Table ───────────────────────
export const monitoredWebsites = pgTable('monitored_websites', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  chain: text('chain'),
  websiteType: websiteTypeEnum('website_type').default('mint_page').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  checkIntervalMinutes: integer('check_interval_minutes').default(5).notNull(),

  // Status tracking
  lastStatus: websiteStatusEnum('last_status').default('unknown').notNull(),
  lastCheckedAt: timestamp('last_checked_at'),
  lastChangeAt: timestamp('last_change_at'),
  lastSnapshot: jsonb('last_snapshot'),
  metadata: jsonb('metadata'),

  // Browserbase integration
  browserSessionId: text('browser_session_id'),
  browserResult: jsonb('browser_result'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  enabledIdx: index('idx_websites_enabled').on(table.enabled),
  typeIdx: index('idx_websites_type').on(table.websiteType),
  lastCheckedIdx: index('idx_websites_last_checked').on(table.lastCheckedAt),
  userIdIdx: index('idx_websites_user_id').on(table.userId),
}));

// ─── Task Executions Table ──────────────────────────
export const taskExecutions = pgTable('task_executions', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  status: text('status').notNull(), // running, completed, failed

  // Timing
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  duration: integer('duration'), // milliseconds

  // Result
  result: jsonb('result'),
  error: jsonb('error'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  taskIdIdx: index('idx_executions_task_id').on(table.taskId),
  statusIdx: index('idx_executions_status').on(table.status),
}));

// ─── Relations ───────────────────────────────────────
export const monitoredWebsitesRelations = relations(monitoredWebsites, ({ one }) => ({
  user: one(users, { fields: [monitoredWebsites.userId], references: [users.id] }),
}));

export const taskExecutionsRelations = relations(taskExecutions, ({ one }) => ({
  task: one(tasks, { fields: [taskExecutions.taskId], references: [tasks.id] }),
}));