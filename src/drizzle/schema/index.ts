import { pgTable, text, timestamp, uuid, integer, pgEnum, json, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ─── Enums ───────────────────────────────────────────
export const chainEnum = pgEnum('chain', ['ethereum', 'base', 'polygon', 'arbitrum']);
export const mintStatusEnum = pgEnum('mint_status', ['pending', 'monitoring', 'ready', 'running', 'completed', 'failed', 'cancelled', 'unconfirmed']);
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
  clerkId: text('clerk_id').notNull(),
  email: text('email').notNull(),
  username: text('username'),
  onboardingCompletedAt: timestamp('onboarding_completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // C-2 fix: explicit unique index on clerkId — every auth request (requireApiUser
  // → syncUser) queries this column. Drizzle's inline .unique() creates a
  // constraint but does NOT generate a named index in migrations. This explicit
  // index ensures the DB planner always uses an index scan, not a seq scan.
  clerkIdIdx: uniqueIndex('idx_users_clerk_id').on(table.clerkId),
}));

export const telegramAccounts = pgTable('telegram_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  telegramId: text('telegram_id').notNull(),
  username: text('username'),
  chatId: text('chat_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_telegram_accounts_user_id').on(table.userId),
  telegramIdIdx: uniqueIndex('idx_telegram_accounts_telegram_id').on(table.telegramId),
  chatIdIdx: uniqueIndex('idx_telegram_accounts_chat_id').on(table.chatId),
}));

export const emailNotificationPreferences = pgTable('email_notification_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  emailEnabled: boolean('email_enabled').default(false).notNull(),
  mintScheduledEnabled: boolean('mint_scheduled_enabled').default(true).notNull(),
  mintSuccessEnabled: boolean('mint_success_enabled').default(true).notNull(),
  mintFailedEnabled: boolean('mint_failed_enabled').default(true).notNull(),
  systemErrorsEnabled: boolean('system_errors_enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: uniqueIndex('idx_email_notification_preferences_user_id').on(table.userId),
}));

// ─── Wallets ─────────────────────────────────────────
export const executionSettings = pgTable('execution_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  defaultMintQuantity: integer('default_mint_quantity').default(1).notNull(),
  defaultWalletId: uuid('default_wallet_id'),
  gasStrategy: text('gas_strategy').default('STANDARD').notNull().$type<'STANDARD' | 'FAST' | 'AGGRESSIVE'>(),
  maxRetries: integer('max_retries').default(25).notNull(),
  receiptRecheckAttempts: integer('receipt_recheck_attempts').default(10).notNull(),
  riskThreshold: integer('risk_threshold').default(75).notNull(),
  autoRunAnalyzer: boolean('auto_run_analyzer').default(true).notNull(),
  autoDetectSocials: boolean('auto_detect_socials').default(true).notNull(),
  autoDetectContractInfo: boolean('auto_detect_contract_info').default(true).notNull(),
  autoDetectMintDetails: boolean('auto_detect_mint_details').default(true).notNull(),
  riskAnalysisEnabled: boolean('risk_analysis_enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: uniqueIndex('idx_execution_settings_user_id').on(table.userId),
}));

export const rpcProviderSettings = pgTable('rpc_provider_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  routingMode: text('routing_mode').default('SMART').notNull().$type<'SMART' | 'MANUAL'>(),
  preferredProvider: text('preferred_provider').$type<'ALCHEMY' | 'INFURA' | 'DRPC' | 'CHAINSTACK' | null>(),
  autoFailover: boolean('auto_failover').default(true).notNull(),
  rpcTimeoutSeconds: integer('rpc_timeout_seconds').default(45).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: uniqueIndex('idx_rpc_provider_settings_user_id').on(table.userId),
}));

export const wallets = pgTable('wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  address: text('address').notNull(),
  nickname: text('nickname'),
  chain: chainEnum('chain').notNull().default('ethereum'),
  walletType: text('wallet_type').default('UNKNOWN').notNull().$type<'EVM' | 'SOLANA' | 'BITCOIN' | 'UNKNOWN'>(),
  isDefault: boolean('is_default').default(false).notNull(),
  encryptedPrivateKey: text('encrypted_private_key'),
  encryptionVersion: integer('encryption_version').default(1),
  balance: text('balance'),
  balanceSymbol: text('balance_symbol'),
  balanceUpdatedAt: timestamp('balance_updated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  defaultWalletIdx: uniqueIndex('idx_wallets_default_per_user').on(table.userId).where(sql`${table.isDefault} = true`),
}));

export const watchedWallets = pgTable('watched_wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  walletName: text('wallet_name'),
  walletAddress: text('wallet_address').notNull(),
  networkType: text('network_type').default('EVM').notNull().$type<'EVM' | 'SOLANA' | 'BITCOIN'>(),
  chain: chainEnum('chain').notNull().default('ethereum'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_watched_wallets_user_id').on(table.userId),
  walletAddressIdx: index('idx_watched_wallets_wallet_address').on(table.walletAddress),
  userWalletChainIdx: uniqueIndex('idx_watched_wallets_user_wallet_chain').on(table.userId, table.walletAddress, table.chain),
}));

export const copyMintRules = pgTable('copy_mint_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  walletAddress: text('wallet_address').notNull(),
  maxPrice: text('max_price'),
  quantity: integer('quantity').default(1).notNull(),
  riskThreshold: integer('risk_threshold').default(75).notNull(),
  destinationWalletId: uuid('destination_wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  autoMint: boolean('auto_mint').default(false).notNull(),
  minMintCount: integer('min_mint_count').default(1).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_copy_mint_rules_user_id').on(table.userId),
  walletAddressIdx: index('idx_copy_mint_rules_wallet_address').on(table.walletAddress),
  userWalletIdx: uniqueIndex('idx_copy_mint_rules_user_wallet').on(table.userId, table.walletAddress),
}));

export const trustedWallets = pgTable('trusted_wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  label: text('label'),
  active: boolean('active').default(true).notNull(),
}, (table) => ({
  walletAddressIdx: uniqueIndex('idx_trusted_wallets_wallet_address').on(table.walletAddress),
  activeIdx: index('idx_trusted_wallets_active').on(table.active),
}));



export const analyticsEvents = pgTable('analytics_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  status: text('status').notNull(),
  provider: text('provider'),
  durationMs: integer('duration_ms'),
  metadata: json('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_analytics_events_user_id').on(table.userId),
  eventTypeIdx: index('idx_analytics_events_event_type').on(table.eventType),
  providerIdx: index('idx_analytics_events_provider').on(table.provider),
  createdAtIdx: index('idx_analytics_events_created_at').on(table.createdAt),
}));



export const collectionOutcomes = pgTable('collection_outcomes', {
  id: uuid('id').defaultRandom().primaryKey(),
  contract: text('contract').notNull(),
  collectionName: text('collection_name'),
  originalRiskScore: integer('original_risk_score').notNull(),
  outcome: text('outcome').notNull(),
  discoveredAt: timestamp('discovered_at').defaultNow().notNull(),
  evaluatedAt: timestamp('evaluated_at').defaultNow().notNull(),
}, (table) => ({
  contractIdx: index('idx_collection_outcomes_contract').on(table.contract),
  outcomeIdx: index('idx_collection_outcomes_outcome').on(table.outcome),
  evaluatedAtIdx: index('idx_collection_outcomes_evaluated_at').on(table.evaluatedAt),
}));

export const riskWeightPerformance = pgTable('risk_weight_performance', {
  id: uuid('id').defaultRandom().primaryKey(),
  contractWeight: integer('contract_weight').notNull(),
  walletWeight: integer('wallet_weight').notNull(),
  socialWeight: integer('social_weight').notNull(),
  domainWeight: integer('domain_weight').notNull(),
  predictionAccuracy: integer('prediction_accuracy').default(0).notNull(),
  falsePositives: integer('false_positives').default(0).notNull(),
  falseNegatives: integer('false_negatives').default(0).notNull(),
  evaluatedAt: timestamp('evaluated_at').defaultNow().notNull(),
}, (table) => ({
  evaluatedAtIdx: index('idx_risk_weight_performance_evaluated_at').on(table.evaluatedAt),
}));

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
  previousFloorPrice: text('previous_floor_price'),
  floorChangePercent: text('floor_change_percent'),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_collections_user_id').on(table.userId),
  contractChainIdx: uniqueIndex('idx_collections_contract_chain').on(table.userId, table.contractAddress, table.chain),
  contractAddressIdx: index('idx_collections_contract_address').on(table.contractAddress),
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
  qstashMessageId: text('qstash_message_id'),
  scheduledTime: timestamp('scheduled_time'),
  phase: text('phase').$type<'whitelist' | 'allowlist' | 'public'>(),
  overrideRiskFlag: boolean('override_risk_flag').default(false).notNull(),
  riskScore: integer('risk_score'),
  riskReasons: json('risk_reasons').$type<string[]>(),
  gasStrategy: text('gas_strategy').default('STANDARD').notNull().$type<'STANDARD' | 'FAST' | 'AGGRESSIVE'>(),
  maxRetries: integer('max_retries').default(25).notNull(),
  // Dedicated counter for retrying a failed on-chain execution attempt
  // (RPC blip, nonce race, transient gas estimation error, etc.) — separate
  // from `maxRetries`, which is reused as the "reschedule while waiting for
  // mint to go live" counter. Fixed at 5 attempts, 2s apart (see
  // EXECUTION_RETRY_DELAY_MS / EXECUTION_MAX_RETRIES in qstash.service.ts).
  executionRetriesRemaining: integer('execution_retries_remaining').default(5).notNull(),
  receiptRecheckAttempts: integer('receipt_recheck_attempts').default(10).notNull(),
  riskThreshold: integer('risk_threshold').default(75).notNull(),
  originalRiskScore: integer('original_risk_score'),
  latestRiskScore: integer('latest_risk_score'),
  originalRiskReasons: json('original_risk_reasons').$type<string[]>(),
  latestRiskReasons: json('latest_risk_reasons').$type<string[]>(),
  safeModeEnabled: boolean('safe_mode_enabled').default(false).notNull(),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // M-09 Fix: composite index mirrors migration 0018_performance_indexes.sql.
  // Every dashboard render and QStash status check queries by (userId, status).
  // Without this, PostgreSQL falls back to a full table scan as task history grows.
  // Declaring it here keeps the schema as the single source of truth so
  // drizzle-kit push and migrations produce identical results.
    userStatusIdx: index('idx_mint_tasks_user_status').on(table.userId, table.status),
  contractAddressIdx: index('idx_mint_tasks_contract_address').on(table.contractAddress),
}));

// ─── Mint History ────────────────────────────────────
export const mintHistory = pgTable('mint_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  walletId: uuid('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),
  status: mintHistoryStatusEnum('status').default('pending').notNull(),
  transactionHash: text('transaction_hash'),
  idempotencyKey: text('idempotency_key').unique(),
  gasUsed: text('gas_used'),
  blockNumber: text('block_number'),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // H-1 fix: missing indexes caused full table scans on every dashboard load and
  // history query. These three cover the common WHERE/ORDER BY access patterns.
  userIdIdx:         index('idx_mint_history_user_id').on(table.userId),
  userCreatedAtIdx:  index('idx_mint_history_user_created_at').on(table.userId, table.createdAt),
  statusIdx:         index('idx_mint_history_status').on(table.status),
}));

export const analyzerHistory = pgTable('analyzer_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  input: text('input').notNull(),
  sourceUrl: text('source_url').notNull(),
  collectionName: text('collection_name'),
  contractAddress: text('contract_address'),
  chain: text('chain').notNull(),
  riskScore: integer('risk_score').notNull(),
  riskLevel: text('risk_level').notNull().default('Medium'),
  riskFactors: json('risk_factors').$type<string[]>(),
  floorPrice: text('floor_price'),
  floorCurrency: text('floor_currency'),
  floorSymbol: text('floor_symbol'),
  ownerCount: integer('owner_count'),
  volume: text('volume'),
  marketStatus: text('market_status'),
  healthScore: integer('health_score'),
  opportunityScore: integer('opportunity_score').notNull(),
  readinessScore: integer('readiness_score').notNull(),
  mintState: text('mint_state').notNull(),
  providerUsed: text('provider_used').notNull(),
  cacheUsed: boolean('cache_used').default(false).notNull(),
  rpcProviderUsed: text('rpc_provider_used'),
  providerChain: json('provider_chain').$type<Array<{ provider: string; status: 'success' | 'failed'; durationMs: number }>>(),
  timingBreakdown: json('timing_breakdown').$type<Array<{ stage: string; durationMs: number }>>(),
  socials: json('socials').$type<{
    website?: string;
    twitter?: string;
    discord?: string;
    telegram?: string;
  }>(),
  socialCount: integer('social_count').notNull().default(0),
  analysisDurationMs: integer('analysis_duration_ms').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_analyzer_history_user_id').on(table.userId),
  userCreatedAtIdx: index('idx_analyzer_history_user_created_at').on(table.userId, table.createdAt),
  chainIdx: index('idx_analyzer_history_chain').on(table.chain),
  contractIdx: index('idx_analyzer_history_contract').on(table.contractAddress),
}));

// ─── Activities ──────────────────────────────────────
export const activities = pgTable('activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  type: activityTypeEnum('type').notNull(),
  title: text('title').notNull(),
  metadata: json('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // H-1 fix: activities are queried by userId on every notification-bell open.
  userIdIdx:        index('idx_activities_user_id').on(table.userId),
  userCreatedAtIdx: index('idx_activities_user_created_at').on(table.userId, table.createdAt),
}));

// ─── Task Logs ───────────────────────────────────────
export const taskLogs = pgTable('task_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').references(() => mintTasks.id, { onDelete: 'cascade' }).notNull(),
  event: text('event').notNull(),
  status: text('status').notNull(),
  message: text('message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // H-1 fix: task console polls /api/mints/:id/logs every 2s on active tasks.
  // Without this index every poll is a full table scan on task_logs.
  taskIdIdx:           index('idx_task_logs_task_id').on(table.taskId),
  taskIdCreatedAtIdx:  index('idx_task_logs_task_id_created_at').on(table.taskId, table.createdAt),
}));

// ─── Collection Syncs ────────────────────────────────
export const collectionSyncs = pgTable('collection_syncs', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').default('synced').notNull(),
  message: text('message'),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
});

export const integrationSettings = pgTable('integration_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').unique().notNull(),
  valueEncrypted: text('value_encrypted').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});


// ─── Relations ───────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  wallets: many(wallets),
  watchedWallets: many(watchedWallets),
  copyMintRules: many(copyMintRules),
  collections: many(collections),
  mintTasks: many(mintTasks),
  mintHistory: many(mintHistory),
  analyzerHistory: many(analyzerHistory),
  activities: many(activities),
  telegramAccounts: many(telegramAccounts),
  emailNotificationPreferences: many(emailNotificationPreferences),
  executionSettings: many(executionSettings),
  rpcProviderSettings: many(rpcProviderSettings),
}));

export const telegramAccountsRelations = relations(telegramAccounts, ({ one }) => ({
  user: one(users, { fields: [telegramAccounts.userId], references: [users.id] }),
}));

export const emailNotificationPreferencesRelations = relations(emailNotificationPreferences, ({ one }) => ({
  user: one(users, { fields: [emailNotificationPreferences.userId], references: [users.id] }),
}));

export const executionSettingsRelations = relations(executionSettings, ({ one }) => ({
  user: one(users, { fields: [executionSettings.userId], references: [users.id] }),
  defaultWallet: one(wallets, { fields: [executionSettings.defaultWalletId], references: [wallets.id] }),
}));

export const rpcProviderSettingsRelations = relations(rpcProviderSettings, ({ one }) => ({
  user: one(users, { fields: [rpcProviderSettings.userId], references: [users.id] }),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
}));

export const watchedWalletsRelations = relations(watchedWallets, ({ one }) => ({
  user: one(users, { fields: [watchedWallets.userId], references: [users.id] }),
}));

export const copyMintRulesRelations = relations(copyMintRules, ({ one }) => ({
  user: one(users, { fields: [copyMintRules.userId], references: [users.id] }),
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

export const analyzerHistoryRelations = relations(analyzerHistory, ({ one }) => ({
  user: one(users, { fields: [analyzerHistory.userId], references: [users.id] }),
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

