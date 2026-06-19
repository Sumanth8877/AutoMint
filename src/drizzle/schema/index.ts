import { pgTable, text, timestamp, uuid, integer, pgEnum, json, boolean, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ───────────────────────────────────────────
export const chainEnum = pgEnum('chain', ['ethereum', 'base', 'polygon']);
export const mintStatusEnum = pgEnum('mint_status', ['pending', 'monitoring', 'ready', 'running', 'completed', 'failed', 'cancelled']);
export const mintHistoryStatusEnum = pgEnum('mint_history_status', ['pending', 'confirmed', 'failed']);
export const activityTypeEnum = pgEnum('activity_type', [
  'wallet_added',
  'wallet_removed',
  'wallet_imported',
  'wallet_balance_changed',
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
  encryptedPrivateKey: text('encrypted_private_key'),
  encryptionVersion: integer('encryption_version').default(1),
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

// ─── Wallet Permissions ──────────────────────────────
export const walletPermissions = pgTable('wallet_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  walletId: uuid('wallet_id').references(() => wallets.id, { onDelete: 'cascade' }).notNull(),
  canMint: boolean('can_mint').default(false).notNull(),
  canMonitor: boolean('can_monitor').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_wallet_permissions_user_id').on(table.userId),
  walletIdIdx: index('idx_wallet_permissions_wallet_id').on(table.walletId),
}));

// ─── Mint Tasks ──────────────────────────────────────
export const mintTasks = pgTable('mint_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  walletId: uuid('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),
  quantity: integer('quantity').default(1).notNull(),
  priority: integer('priority').default(0),
  status: mintStatusEnum('status').default('pending').notNull(),
  contractAddress: text('contract_address'),
  mintFunction: text('mint_function').default('mint'),
  mintPrice: text('mint_price'),
  gasLimit: text('gas_limit'),
  txHash: text('tx_hash'),
  confirmedAt: timestamp('confirmed_at'),
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
  gasUsed: text('gas_used'),
  blockNumber: text('block_number'),
  confirmedAt: timestamp('confirmed_at'),
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

export const activitiesRelations = relations(activities, ({ one }) => ({
  user: one(users, { fields: [activities.userId], references: [users.id] }),
}));

export const taskLogsRelations = relations(taskLogs, ({ one }) => ({
  task: one(mintTasks, { fields: [taskLogs.taskId], references: [mintTasks.id] }),
}));

export const collectionSyncsRelations = relations(collectionSyncs, ({ one }) => ({
  collection: one(collections, { fields: [collectionSyncs.collectionId], references: [collections.id] }),
}));