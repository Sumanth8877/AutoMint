import { pgTable, text, timestamp, uuid, integer, pgEnum, boolean, json } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ───────────────────────────────────────────
export const chainEnum = pgEnum('chain', ['ethereum', 'base', 'polygon']);
export const mintStatusEnum = pgEnum('mint_status', ['pending', 'monitoring', 'ready', 'completed', 'failed', 'cancelled']);
export const mintHistoryStatusEnum = pgEnum('mint_history_status', ['pending', 'confirmed', 'failed']);
export const notificationChannelEnum = pgEnum('notification_channel', ['email', 'in_app', 'discord', 'telegram']);
export const notificationStatusEnum = pgEnum('notification_status', ['pending', 'sent', 'failed']);
export const activityTypeEnum = pgEnum('activity_type', [
  'wallet_added',
  'collection_added',
  'task_created',
  'task_cancelled',
  'task_completed',
  'collection_live',
  'mint_ending_soon',
  'floor_price_changed',
  'mint_status_changed',
]);

// ─── Users ───────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkId: text('clerk_id').unique().notNull(),
  email: text('email').notNull(),
  username: text('username'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Wallets ─────────────────────────────────────────
export const wallets = pgTable('wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  address: text('address').notNull(),
  nickname: text('nickname'),
  chain: chainEnum('chain').notNull().default('ethereum'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Collections ─────────────────────────────────────
export const collections = pgTable('collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name'),
  contractAddress: text('contract_address').notNull(),
  chain: chainEnum('chain').notNull().default('ethereum'),
  tokenStandard: text('token_standard'),
  owner: text('owner'),
  totalSupply: text('total_supply'),
  mintStatus: text('mint_status').default('unknown'),
  mintPrice: text('mint_price'),
  mintStart: timestamp('mint_start'),
  mintEnd: timestamp('mint_end'),
  floorPrice: text('floor_price'),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Mint Tasks ──────────────────────────────────────
export const mintTasks = pgTable('mint_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  walletId: uuid('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),
  quantity: integer('quantity').default(1).notNull(),
  priority: integer('priority').default(0),
  status: mintStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Mint History ────────────────────────────────────
export const mintHistory = pgTable('mint_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  walletId: uuid('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),
  status: mintHistoryStatusEnum('status').default('pending').notNull(),
  transactionHash: text('transaction_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Notifications ───────────────────────────────────
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  channel: notificationChannelEnum('channel').default('in_app').notNull(),
  status: notificationStatusEnum('status').default('pending').notNull(),
  read: boolean('read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Activities ──────────────────────────────────────
export const activities = pgTable('activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  type: activityTypeEnum('type').notNull(),
  title: text('title').notNull(),
  metadata: json('metadata').$type<Record<string, any>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Task Logs ───────────────────────────────────────
export const taskLogs = pgTable('task_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').references(() => mintTasks.id, { onDelete: 'cascade' }).notNull(),
  event: text('event').notNull(),
  status: text('status').notNull(),
  message: text('message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Collection Syncs ────────────────────────────────
export const collectionSyncs = pgTable('collection_syncs', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').default('synced').notNull(),
  message: text('message'),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  wallets: many(wallets),
  collections: many(collections),
  mintTasks: many(mintTasks),
  mintHistory: many(mintHistory),
  notifications: many(notifications),
  activities: many(activities),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
}));

export const collectionsRelations = relations(collections, ({ one }) => ({
  user: one(users, { fields: [collections.userId], references: [users.id] }),
}));

export const mintTasksRelations = relations(mintTasks, ({ one, many }) => ({
  user: one(users, { fields: [mintTasks.userId], references: [users.id] }),
  wallet: one(wallets, { fields: [mintTasks.walletId], references: [wallets.id] }),
  collection: one(collections, { fields: [mintTasks.collectionId], references: [collections.id] }),
  logs: many(taskLogs),
}));

export const mintHistoryRelations = relations(mintHistory, ({ one }) => ({
  user: one(users, { fields: [mintHistory.userId], references: [users.id] }),
  wallet: one(wallets, { fields: [mintHistory.walletId], references: [wallets.id] }),
  collection: one(collections, { fields: [mintHistory.collectionId], references: [collections.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  user: one(users, { fields: [activities.userId], references: [users.id] }),
}));

export const taskLogsRelations = relations(taskLogs, ({ one }) => ({
  task: one(mintTasks, { fields: [taskLogs.taskId], references: [mintTasks.id] }),
}));

export const collectionSyncsRelations = relations(collectionSyncs, ({ one }) => ({
  collection: one(collections, { fields: [collectionSyncs.collectionId], references: [collections.id] }),
}));