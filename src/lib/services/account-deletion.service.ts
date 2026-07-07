import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';
import { and, eq, inArray } from 'drizzle-orm';
import {
  activities,
  analyzerHistory,
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



async function deleteAutoMintUserData(userId: string, clerkId: string) {
  const db = getDb();

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.clerkId, clerkId)))
    .limit(1);

  if (!user) return;

  // Fix #28: wrap all deletes in a single transaction so partial failures
  // cannot orphan data. If any delete fails, the entire operation rolls back.
  await db.transaction(async (tx) => {
    const [userMintTasks, userCollections, userTasks, userWebsites] = await Promise.all([
      tx.select({ id: mintTasks.id }).from(mintTasks).where(eq(mintTasks.userId, userId)),
      tx.select({ id: collections.id }).from(collections).where(eq(collections.userId, userId)),
      tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, userId)),
      tx.select({ id: monitoredWebsites.id }).from(monitoredWebsites).where(eq(monitoredWebsites.userId, userId)),
    ]);

    const mintTaskIds = ids(userMintTasks);
    const collectionIds = ids(userCollections);
    const taskIds = ids(userTasks);
    const websiteIds = ids(userWebsites);

    // Child tables first (FK dependencies)
    if (taskIds.length > 0) await tx.delete(taskExecutions).where(inArray(taskExecutions.taskId as never, taskIds));
    if (websiteIds.length > 0) {
      await tx.delete(browserSessions).where(inArray(browserSessions.websiteId as never, websiteIds));
      await tx.delete(monitoringEvents).where(inArray(monitoringEvents.websiteId as never, websiteIds));
    }
    if (mintTaskIds.length > 0) await tx.delete(taskLogs).where(inArray(taskLogs.taskId as never, mintTaskIds));
    if (collectionIds.length > 0) await tx.delete(collectionSyncs).where(inArray(collectionSyncs.collectionId as never, collectionIds));

    // User-owned tables
    await tx.delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
    await tx.delete(emailNotificationPreferences).where(eq(emailNotificationPreferences.userId, userId));
    await tx.delete(executionSettings).where(eq(executionSettings.userId, userId));
    await tx.delete(rpcProviderSettings).where(eq(rpcProviderSettings.userId, userId));
    await tx.delete(watchedWallets).where(eq(watchedWallets.userId, userId));
    await tx.delete(copyMintRules).where(eq(copyMintRules.userId, userId));
    await tx.delete(analyticsEvents).where(eq(analyticsEvents.userId, userId));
    await tx.delete(analyzerHistory).where(eq(analyzerHistory.userId, userId));
    await tx.delete(activities).where(eq(activities.userId, userId));
    await tx.delete(mintHistory).where(eq(mintHistory.userId, userId));
    await tx.delete(mintTasks).where(eq(mintTasks.userId, userId));
    await tx.delete(wallets).where(eq(wallets.userId, userId));
    await tx.delete(collections).where(eq(collections.userId, userId));
    await tx.delete(monitoredWebsites).where(eq(monitoredWebsites.userId, userId));
    await tx.delete(tasks).where(eq(tasks.userId, userId));
    await tx.delete(users).where(and(eq(users.id, userId), eq(users.clerkId, clerkId)));
  });
}

// H-01 fix: account deletion spans two independent systems (Postgres +
// Clerk) that cannot be committed atomically together. The original code
// deleted the local DB data (wallets, private keys, mint history) inside a
// transaction FIRST, then called Clerk's deleteUser() API. If that external
// call failed (network blip, Clerk outage, rate limit), the route caught the
// error and returned a generic 500 -- but the user's data was already
// permanently gone, while their Clerk identity remained active and would be
// silently re-materialized as a blank account on next login (syncUser()'s
// onConflictDoUpdate creates a fresh `users` row for any valid Clerk session).
//
// Fix: reverse the order. Delete the Clerk identity FIRST:
//   - If Clerk deletion fails, we throw immediately and NOTHING has been
//     touched in the DB yet -- no data loss, the user can safely retry.
//   - If Clerk deletion succeeds but the subsequent DB transaction fails,
//     the Clerk identity is gone but the app data survives. This is the
//     safer failure direction: it is recoverable (a cleanup job or support
//     action can find "Clerk user missing but DB rows exist" and finish the
//     deletion), whereas losing encrypted wallet private keys is not.
export async function deleteAccount(input: DeleteAccountInput) {
  const client = await clerkClient();

  try {
    await client.users.deleteUser(input.clerkId);
  } catch (error) {
    throw new Error(
      'Could not delete your account identity. No data was removed -- please try again. ' +
      `(${error instanceof Error ? error.message : 'unknown error'})`,
    );
  }

  try {
    await deleteAutoMintUserData(input.userId, input.clerkId);
  } catch (error) {
    // Clerk identity is already gone at this point -- the user can no longer
    // log back in, so there is no risk of them seeing stale data. Surface a
    // clear error so this can be reconciled manually (a "Clerk user missing,
    // DB rows exist" cleanup job) rather than silently losing the failure.
    throw new Error(
      'Your account identity was deleted, but some app data could not be removed automatically. ' +
      `Contact support to finish cleanup. (${error instanceof Error ? error.message : 'unknown error'})`,
    );
  }

  return { success: true };
}
