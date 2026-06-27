import 'server-only';

import { logger } from '@/lib/logger';
import { captureException } from '@/lib/observability/sentry';

// ─── Config ──────────────────────────────────────────────────────────────────
// ALCHEMY_AUTH_TOKEN  — Team auth token (not the API key).
//   Dashboard → top-right menu → "Team Settings" → "Auth Token" → Copy
//
// ALCHEMY_WEBHOOK_ID  — ID of the Address Activity webhook you created.
//   Dashboard → Notify → your webhook → copy the wh_xxx ID from the URL or table
//
// Both are optional — if not set, auto-registration is silently skipped.
// The webhook still works manually (you can add addresses in the dashboard).

const ALCHEMY_API = 'https://dashboard.alchemy.com/api/v2';

function getConfig(): { token: string; webhookId: string } | null {
  const token     = process.env.ALCHEMY_AUTH_TOKEN;
  const webhookId = process.env.ALCHEMY_WEBHOOK_ID;
  if (!token || !webhookId) return null;
  return { token, webhookId };
}

/**
 * registerContractForMonitoring
 *
 * Adds a contract address to the Alchemy Address Activity webhook so that
 * any Transfer events from that contract will fire the webhook instantly.
 *
 * Called automatically whenever a new mint task is created.
 * Silent no-op if ALCHEMY_AUTH_TOKEN or ALCHEMY_WEBHOOK_ID are not configured.
 *
 * @param contractAddress  - EVM contract address (0x...)
 */
export async function registerContractForMonitoring(
  contractAddress: string,
): Promise<void> {
  const cfg = getConfig();
  if (!cfg) {
    logger.info('Alchemy auto-registration skipped — env vars not configured', {
      area: 'alchemy-webhook',
    });
    return;
  }

  try {
    const res = await fetch(`${ALCHEMY_API}/webhook-addresses`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Alchemy-Token': cfg.token,
      },
      body: JSON.stringify({
        webhook_id: cfg.webhookId,
        addresses_to_add: [contractAddress.toLowerCase()],
        addresses_to_remove: [],
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      logger.warn('Alchemy webhook registration failed', {
        area: 'alchemy-webhook',
        status: res.status,
        contract: contractAddress,
        error: err.slice(0, 200),
      });
      return;
    }

    logger.info('Contract registered for Alchemy webhook monitoring', {
      area: 'alchemy-webhook',
      contract: contractAddress,
      webhookId: cfg.webhookId,
    });
  } catch (error) {
    // Non-blocking — a failed registration just means we fall back to the
    // 30s polling loop. Don't let this break the mint task creation.
    await captureException(error, {
      area: 'alchemy-webhook',
      context: { contractAddress },
      fingerprint: ['alchemy-webhook', 'registration-error'],
    }).catch(() => {});
  }
}

/**
 * unregisterContract
 *
 * Removes a contract address from the Alchemy webhook.
 * Called when a mint task is deleted or completed so we don't accumulate
 * stale addresses on the webhook.
 *
 * @param contractAddress  - EVM contract address (0x...)
 */
export async function unregisterContract(
  contractAddress: string,
): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;

  try {
    await fetch(`${ALCHEMY_API}/webhook-addresses`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Alchemy-Token': cfg.token,
      },
      body: JSON.stringify({
        webhook_id: cfg.webhookId,
        addresses_to_add: [],
        addresses_to_remove: [contractAddress.toLowerCase()],
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Best-effort cleanup — ignore errors
  }
}

/**
 * listMonitoredContracts
 *
 * Returns all contract addresses currently registered on the webhook.
 * Useful for debugging / the admin panel.
 */
export async function listMonitoredContracts(): Promise<string[]> {
  const cfg = getConfig();
  if (!cfg) return [];

  try {
    const res = await fetch(
      `${ALCHEMY_API}/webhook-addresses?webhook_id=${cfg.webhookId}&limit=1000`,
      {
        headers: { 'X-Alchemy-Token': cfg.token },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ address: string }> };
    return (json.data ?? []).map(e => e.address);
  } catch {
    return [];
  }
}
