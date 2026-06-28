import { NextResponse } from 'next/server';
import { verifyAlchemyWebhookSignature } from '@/lib/services/wallet-tracker.service';
import { captureException } from '@/lib/observability/sentry';
import { getDb } from '@/lib/db';
import { mintTasks } from '@/drizzle/schema';
import { and, inArray } from 'drizzle-orm';
import { scheduleMint } from '@/lib/services/qstash.service';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface AlchemyLog {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
}

interface AlchemyWebhookPayload {
  webhookId?: string;
  id?: string;
  createdAt?: string;
  type?: string;
  event?: {
    network?: string;
    activity?: AlchemyLog[];
    data?: {
      block?: {
        logs?: AlchemyLog[];
        transactions?: unknown[];
      };
    };
  };
}

// ERC-721 Transfer event topic (keccak256 of "Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// address(0) — indicates a mint (transfer from the zero address)
const ZERO_ADDRESS_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * POST /api/webhooks/alchemy/contract
 *
 * Alchemy "Custom Webhook" handler for contract-level Transfer events.
 *
 * When Alchemy detects a Transfer(from=0x0, ...) event on a monitored mint
 * contract, this webhook fires within ~1 second. We immediately schedule
 * execution for any pending/monitoring task targeting that contract.
 *
 * Setup in Alchemy dashboard:
 *   Webhooks → Custom Webhook → Add addresses: [your target contracts]
 *   Filter: Transfer events only (topic0 = TRANSFER_TOPIC)
 *   URL: https://your-app.vercel.app/api/webhooks/alchemy/contract
 *
 * This reduces mint detection latency from 8–38s (WebSocket + QStash loop)
 * to < 1s (Alchemy notifies us the instant the first Transfer is indexed).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    // Verify Alchemy signature (reuse wallet webhook verification)
    try {
      verifyAlchemyWebhookSignature(request.headers, rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    let payload: AlchemyWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as AlchemyWebhookPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Extract logs from Alchemy payload (supports both GraphQL and REST format)
    const logs: AlchemyLog[] = payload.event?.activity
      ?? payload.event?.data?.block?.logs
      ?? [];

    if (logs.length === 0) {
      return NextResponse.json({ ok: true, handled: 0 });
    }

    // Find mint Transfer events: Transfer(from=0x0, to=anyone, tokenId=anything)
    const mintContracts = new Set<string>();
    for (const log of logs) {
      const topics = log.topics ?? [];
      const isMint =
        topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
        topics[1]?.toLowerCase() === ZERO_ADDRESS_TOPIC;

      if (isMint && log.address) {
        mintContracts.add(log.address.toLowerCase());
      }
    }

    if (mintContracts.size === 0) {
      return NextResponse.json({ ok: true, handled: 0 });
    }

    logger.info('Alchemy contract webhook: mint Transfer detected', {
      area: 'webhooks/alchemy/contract',
      contracts: [...mintContracts],
    });

    // L3 fix: previously this loaded every active task and filtered by
    // contractAddress in JS. Push the filter into SQL so the DB returns only
    // rows for the contracts in this webhook payload — the contractAddress
    // index (idx_mint_tasks_contract_address) makes this an index scan.
    const contractsLower = [...mintContracts];
    const db = getDb();
    const tasksToTrigger = await db
      .select({ id: mintTasks.id, userId: mintTasks.userId, contractAddress: mintTasks.contractAddress })
      .from(mintTasks)
      .where(
        and(
          inArray(mintTasks.status, ['pending', 'monitoring', 'ready']),
          inArray(mintTasks.contractAddress, contractsLower),
        ),
      );

    if (tasksToTrigger.length === 0) {
      return NextResponse.json({ ok: true, handled: 0, message: 'No pending tasks for these contracts' });
    }

    // Schedule immediate execution (5s delay to give the block time to propagate)
    const immediateTime = new Date(Date.now() + 5_000);
    let triggered = 0;

    for (const task of tasksToTrigger) {
      try {
        await scheduleMint({ taskId: task.id, userId: task.userId, scheduledTime: immediateTime, initialStatus: 'ready' });
        triggered++;
        logger.info('Alchemy webhook triggered immediate mint execution', {
          area: 'webhooks/alchemy/contract',
          taskId: task.id,
          contractAddress: task.contractAddress,
        });
      } catch (err) {
        await captureException(err, {
          area: 'webhooks/alchemy/contract',
          context: { taskId: task.id },
          fingerprint: ['alchemy-contract-webhook', 'schedule-error'],
        });
      }
    }

    return NextResponse.json({ ok: true, handled: triggered, contracts: [...mintContracts] });
  } catch (error) {
    await captureException(error, {
      area: 'webhooks/alchemy/contract',
      context: { route: '/api/webhooks/alchemy/contract' },
      fingerprint: ['alchemy-contract-webhook', 'unhandled'],
    });
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
