import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';
import { and, eq, inArray } from 'drizzle-orm';
import {
  activities,
  analyticsEvents,
  collections,
  collectionSyncs,
  copyMintRules,
  emailNotificationPreferences,
  executionSettings,
  mintHistory,
  mintTasks,
  rpcProviderSettings,
  taskLogs,
  telegramAccounts,
  users,
  walletPermissions,
  wallets,
  watchedWallets,
} from '@/drizzle/schema';
import { tasks } from '@/drizzle/schema/tasks';
import {
  browserSessions,
  monitoredWebsites,
  monitoringEvents,
  taskExecutions,
} from '@/drizzle/schema/monitoring';
import { getDb } from '@/lib/db';

type DeleteAccountInput = {
  userId: string;
  clerkId: string;
};

function ids(rows: Array<{ id: string }>) {
  return rows.map((row) => row.id);
}

async function deleteWhereIn<TColumn>(table: Parameters<ReturnType<typeof getDb>['delete']>[0], column: TColumn, values: string[]) {
  if (values.length === 0) return;
  await getDb().delete(table).where(inArray(column as never, values));
}

async function deleteAutoMintUserData(userId: string, clerkId: string) {
  const [user] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.clerkId, clerkId)))
    .limit(1);

  if (!user) return;

  const [userMintTasks, userCollections, userTasks, userWebsites] = await Promise.all([
    getDb().select({ id: mintTasks.id }).from(mintTasks).where(eq(mintTasks.userId, userId)),
    getDb().select({ id: collections.id }).from(collections).where(eq(collections.userId, userId)),
    getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, userId)),
    getDb().select({ id: monitoredWebsites.id }).from(monitoredWebsites).where(eq(monitoredWebsites.userId, userId)),
  ]);

  const mintTaskIds = ids(userMintTasks);
  const collectionIds = ids(userCollections);
  const taskIds = ids(userTasks);
  const websiteIds = ids(userWebsites);

  await deleteWhereIn(taskExecutions, taskExecutions.taskId, taskIds);
  await deleteWhereIn(browserSessions, browserSessions.websiteId, websiteIds);
  await deleteWhereIn(monitoringEvents, monitoringEvents.websiteId, websiteIds);
  await deleteWhereIn(taskLogs, taskLogs.taskId, mintTaskIds);
  await deleteWhereIn(collectionSyncs, collectionSyncs.collectionId, collectionIds);

  await getDb().delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
  await getDb().delete(emailNotificationPreferences).where(eq(emailNotificationPreferences.userId, userId));
  await getDb().delete(executionSettings).where(eq(executionSettings.userId, userId));
  await getDb().delete(rpcProviderSettings).where(eq(rpcProviderSettings.userId, userId));
  await getDb().delete(walletPermissions).where(eq(walletPermissions.userId, userId));
  await getDb().delete(watchedWallets).where(eq(watchedWallets.userId, userId));
  await getDb().delete(copyMintRules).where(eq(copyMintRules.userId, userId));
  await getDb().delete(analyticsEvents).where(eq(analyticsEvents.userId, userId));
  await getDb().delete(activities).where(eq(activities.userId, userId));
  await getDb().delete(mintHistory).where(eq(mintHistory.userId, userId));
  await getDb().delete(mintTasks).where(eq(mintTasks.userId, userId));
  await getDb().delete(wallets).where(eq(wallets.userId, userId));
  await getDb().delete(collections).where(eq(collections.userId, userId));
  await getDb().delete(monitoredWebsites).where(eq(monitoredWebsites.userId, userId));
  await getDb().delete(tasks).where(eq(tasks.userId, userId));
  await getDb().delete(users).where(and(eq(users.id, userId), eq(users.clerkId, clerkId)));
}

export async function deleteAccount(input: DeleteAccountInput) {
  await deleteAutoMintUserData(input.userId, input.clerkId);

  const client = await clerkClient();
  await client.users.deleteUser(input.clerkId);

  return { success: true };
}
