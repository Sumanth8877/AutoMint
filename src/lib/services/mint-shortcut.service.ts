/**
 * mint-shortcut.service.ts
 *
 * Parses direct mint shortcut commands so they BYPASS the AI interpreter
 * entirely and call the mint API directly. Zero LLM cost, ~0 latency overhead.
 *
 * Supported patterns (case-insensitive, leading/trailing whitespace stripped):
 *   <url>                  →  mint 1 from URL
 *   <url> <qty>            →  mint N from URL
 *   /mint <url>            →  mint 1 from URL
 *   /mint <url> <qty>      →  mint N from URL
 *
 * Where <url> is:
 *   - https:// or http:// URL
 *   - 0x EVM contract address (40 hex chars)
 *   - chain-prefixed address  e.g. "base:0x..."
 */

// ── Regex pieces ─────────────────────────────────────────────────────────────

/** Matches https/http URLs */
const URL_RE = /https?:\/\/\S+/i;

/** Matches a bare 0x EVM address (optional chain: prefix) */
const ADDR_RE = /(?:[a-z]+:)?0x[0-9a-fA-F]{40}/i;

/** Either a URL or an address */
const MINT_TARGET_RE = new RegExp(`(${URL_RE.source}|${ADDR_RE.source})`, 'i');

/** Optional quantity suffix: 1–99 */
const QTY_RE = /\s+(\d{1,2})$/;

/** /mint prefix */
const SLASH_MINT_RE = /^\/mint\s+/i;

// ── Parsed result ─────────────────────────────────────────────────────────────

export interface MintShortcut {
  mintUrl: string;
  quantity: number;
}

/**
 * Returns a parsed MintShortcut if the message matches a direct mint pattern,
 * or null if it should be handled by the AI interpreter.
 */
export function parseMintShortcut(rawMessage: string): MintShortcut | null {
  const msg = rawMessage.trim();
  if (!msg) return null;

  // Strip leading /mint
  const stripped = SLASH_MINT_RE.test(msg) ? msg.replace(SLASH_MINT_RE, '') : msg;

  // Extract optional trailing quantity
  const qtyMatch = stripped.match(QTY_RE);
  const quantity  = qtyMatch ? Math.max(1, Math.min(99, parseInt(qtyMatch[1], 10))) : 1;
  const withoutQty = qtyMatch ? stripped.slice(0, -qtyMatch[0].length) : stripped;

  // Must be ONLY a URL/address (nothing else)
  const targetMatch = withoutQty.trim().match(new RegExp(`^${MINT_TARGET_RE.source}$`, 'i'));
  if (!targetMatch) return null;

  return { mintUrl: targetMatch[1], quantity };
}

/**
 * Execute a mint shortcut via the internal mint service.
 * Returns a human-readable reply string for both Telegram and web chat.
 */
export async function executeMintShortcut(
  shortcut: MintShortcut,
  userId: string,
): Promise<string> {
  // Import lazily (server-only, avoids circular deps)
  const { createMintTaskFromUrl } = await import('@/lib/services/mint-orchestrator.service');
  const { getDb } = await import('@/lib/db');
  const { wallets } = await import('@/drizzle/schema');
  const { eq } = await import('drizzle-orm');

  // Resolve default wallet
  const [wallet] = await getDb()
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);

  if (!wallet) {
    return (
      '❌ No wallet configured.\n' +
      'Add a wallet first: go to **Wallets** or tell me `"add my wallet 0x..."`'
    );
  }

  const result = await createMintTaskFromUrl(
    shortcut.mintUrl,
    wallet.id,
    userId,
    shortcut.quantity,
  );

  if (result.error) {
    return `❌ Mint failed: ${result.error}`;
  }

  const qtyLabel = shortcut.quantity > 1 ? ` ×${shortcut.quantity}` : '';

  if ((result.action as string) === 'executed') {
    return (
      `⚡ Mint executed${qtyLabel}!\n` +
      `Task ID: \`${result.taskId}\`\n` +
      `Check the **Mints** page for the transaction result.`
    );
  }

  if ((result.action as string) === 'scheduled') {
    return (
      `✅ Mint queued${qtyLabel}.\n` +
      `Task ID: \`${result.taskId}\`\n` +
      `AutoMint is monitoring the contract and will execute when the mint goes live.`
    );
  }

  return (
    `✅ Mint task created${qtyLabel}.\n` +
    `Task ID: \`${result.taskId ?? 'unknown'}\`\n` +
    `Check the **Mints** page for status.`
  );
}
