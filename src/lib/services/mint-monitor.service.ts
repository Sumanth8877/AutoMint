import 'server-only';

import { createPublicClient, webSocket } from 'viem';
import { getChain } from '@/lib/blockchain/chains';
import { getMintState } from '@/lib/services/mint-state.service';
import { addBreadcrumb, captureException } from '@/lib/observability/sentry';
import { getAllSettings } from '@/lib/services/integration-settings.service';

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * How long to hold the WebSocket subscription open per invocation.
 * Must be safely under the Vercel function timeout:
 *   Hobby: 10s  → use WATCH_TIMEOUT_MS = 8_000
 *   Pro:   60s  → use WATCH_TIMEOUT_MS = 25_000 (default)
 *
 * After timeout, the caller reschedules via QStash and we watch again.
 */
const WATCH_TIMEOUT_MS = 25_000;

export type MonitorResult =
  | 'live'     // mint went live — execute immediately
  | 'ended'    // mint ended — mark task failed
  | 'timeout'  // watch window expired — reschedule for next window
  | 'error';   // WebSocket failed — fall back to HTTP polling

// ─── WebSocket URL resolution ─────────────────────────────────────────────────
//
// Derives WSS endpoint from the same Alchemy API key used for HTTP.
// Alchemy WebSocket URLs use the same key — just swap https for wss.

async function getWebSocketUrl(chain: string): Promise<string | null> {
  try {
    const settings = await getAllSettings();
    const apiKey = settings.ALCHEMY_API_KEY?.value || process.env.ALCHEMY_API_KEY;

    if (apiKey) {
      const chainLower = chain.toLowerCase();
      if (chainLower === 'base')    return `wss://base-mainnet.g.alchemy.com/v2/${apiKey}`;
      if (chainLower === 'polygon') return `wss://polygon-mainnet.g.alchemy.com/v2/${apiKey}`;
      return `wss://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
    }

    // Fall back to env-var WSS URL if configured
    return process.env[`ALCHEMY_${chain.toUpperCase()}_WSS_URL`]
      || process.env.ALCHEMY_WSS_URL
      || null;
  } catch {
    return null;
  }
}

// ─── Main monitor ─────────────────────────────────────────────────────────────

/**
 * Watch for a mint to go live using WebSocket block subscriptions.
 *
 * Opens a WebSocket connection to the RPC provider and subscribes to new block
 * headers. On each new block, checks the contract mint state via getMintState().
 * Resolves immediately when the mint goes live or ended.
 *
 * If WebSocket is unavailable or fails, returns 'error' so the caller can fall
 * back to the existing HTTP polling path (60s QStash reschedule).
 *
 * Latency improvement vs HTTP polling:
 *   Base (2s blocks):     0–2s detection   (was 0–60s, 30× faster)
 *   Ethereum (12s blocks): 0–12s detection  (was 0–60s,  5× faster)
 *
 * @param contractAddress  - Contract to watch
 * @param chain            - Chain name ('ethereum', 'base', 'polygon')
 * @param timeoutMs        - Max watch window (default 25s, adjust for plan tier)
 */
export async function watchForMintLive(
  contractAddress: string,
  chain: string,
  timeoutMs = WATCH_TIMEOUT_MS,
): Promise<MonitorResult> {
  const wsUrl = await getWebSocketUrl(chain);

  if (!wsUrl) {
    addBreadcrumb({
      category: 'mint-monitor',
      message: 'No WebSocket URL configured — falling back to HTTP polling',
      level: 'info',
      data: { chain },
    });
    return 'error'; // Caller will use HTTP polling reschedule
  }

  let viemChain;
  try {
    viemChain = getChain(chain);
  } catch {
    return 'error';
  }

  return new Promise<MonitorResult>((resolve) => {
    let settled = false;
    let unwatch: (() => void) | null = null;
    let client: ReturnType<typeof createPublicClient> | null = null;

    function settle(result: MonitorResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // Cleanup WebSocket subscription and client
      try { unwatch?.(); } catch {}
      try { (client as unknown as { destroy?: () => void })?.destroy?.(); } catch {}

      addBreadcrumb({
        category: 'mint-monitor',
        message: `WebSocket monitor settled: ${result}`,
        level: 'info',
        data: { contractAddress, chain, result },
      });

      resolve(result);
    }

    // Hard timeout — releases resources and signals caller to reschedule
    const timer = setTimeout(() => settle('timeout'), timeoutMs);

    // Create WebSocket client
    try {
      client = createPublicClient({
        chain: viemChain,
        transport: webSocket(wsUrl, {
          timeout: timeoutMs + 5_000, // slightly longer than our watch window
          reconnect: false,           // don't reconnect — we control the lifecycle
        }),
      });
    } catch (err) {
      clearTimeout(timer);
      captureException(err, { area: 'mint-monitor', context: { chain }, fingerprint: ['mint-monitor', 'client-error'] });
      resolve('error');
      return;
    }

    // Subscribe to new block headers
    // On each new block, check mint state — a mint can only go live on a block boundary
    try {
      unwatch = client.watchBlockNumber({
        onBlockNumber: async (blockNumber: bigint) => {
          if (settled) return;

          try {
            const state = await getMintState(contractAddress, chain);

            addBreadcrumb({
              category: 'mint-monitor',
              message: `Block ${blockNumber}: mint state = ${state.status}`,
              level: 'info',
              data: { contractAddress, chain, blockNumber: blockNumber.toString(), status: state.status },
            });

            if (state.status === 'LIVE') {
              settle('live');
            } else if (state.status === 'ENDED') {
              settle('ended');
            }
            // NOT_STARTED or UNKNOWN — keep watching
          } catch {
            // Ignore individual block check errors — keep watching
          }
        },
        onError: (error: Error) => {
          if (settled) return;
          addBreadcrumb({
            category: 'mint-monitor',
            message: 'WebSocket subscription error',
            level: 'warning',
            data: { error: String(error) },
          });
          settle('error'); // Fall back to HTTP polling
        },
        emitOnBegin: true, // Check immediately on subscription (no wait for next block)
      } as Parameters<ReturnType<typeof createPublicClient>['watchBlockNumber']>[0]);
    } catch (err) {
      clearTimeout(timer);
      captureException(err, { area: 'mint-monitor', context: { chain }, fingerprint: ['mint-monitor', 'subscribe-error'] });
      resolve('error');
    }
  });
}
