import 'server-only';

import { eq } from 'drizzle-orm';
import { rpcProviderSettings } from '@/drizzle/schema';
import { getDb } from '@/lib/db';

export const RPC_ROUTING_MODES = ['SMART', 'MANUAL'] as const;
export const RPC_PREFERRED_PROVIDERS = ['ALCHEMY', 'INFURA', 'DRPC', 'CHAINSTACK'] as const;

export type RpcRoutingMode = (typeof RPC_ROUTING_MODES)[number];
export type RpcPreferredProvider = (typeof RPC_PREFERRED_PROVIDERS)[number];

export type RpcProviderSettingsUpdate = {
  routingMode?: RpcRoutingMode;
  preferredProvider?: RpcPreferredProvider | null;
  autoFailover?: boolean;
  rpcTimeoutSeconds?: number;
};

function clampInteger(value: number, min: number, max: number, field: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

function assertBoolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') throw new Error(`${field} must be true or false`);
  return value;
}

function assertRoutingMode(value: unknown) {
  if (!RPC_ROUTING_MODES.includes(value as RpcRoutingMode)) {
    throw new Error('Routing mode must be SMART or MANUAL');
  }
  return value as RpcRoutingMode;
}

function assertPreferredProvider(value: unknown) {
  if (value === null || value === '') return null;
  if (!RPC_PREFERRED_PROVIDERS.includes(value as RpcPreferredProvider)) {
    throw new Error('Preferred provider must be ALCHEMY, INFURA, DRPC, or CHAINSTACK');
  }
  return value as RpcPreferredProvider;
}

export async function getRpcProviderSettings(userId: string) {
  const [existing] = await getDb()
    .select()
    .from(rpcProviderSettings)
    .where(eq(rpcProviderSettings.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await getDb()
    .insert(rpcProviderSettings)
    .values({ userId })
    .returning();

  return created;
}

export async function updateRpcProviderSettings(userId: string, input: Record<string, unknown>) {
  await getRpcProviderSettings(userId);

  const update: RpcProviderSettingsUpdate = {};

  if ('routingMode' in input) update.routingMode = assertRoutingMode(input.routingMode);
  if ('preferredProvider' in input) update.preferredProvider = assertPreferredProvider(input.preferredProvider);
  if ('autoFailover' in input) update.autoFailover = assertBoolean(input.autoFailover, 'autoFailover');
  if ('rpcTimeoutSeconds' in input) {
    update.rpcTimeoutSeconds = clampInteger(Number(input.rpcTimeoutSeconds), 5, 120, 'RPC request timeout');
  }

  const [updated] = await getDb()
    .update(rpcProviderSettings)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(rpcProviderSettings.userId, userId))
    .returning();

  return updated;
}
