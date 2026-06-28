import 'server-only';

import { parseAbi, parseEther, parseGwei, Hex, encodeFunctionData, ContractFunctionRevertedError } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getClient } from './client';
import { getChain } from './chains';
import { getWalletClient, broadcastRawTransaction } from '@/lib/services/rpc-manager.service';
import { getDecryptedPrivateKey } from '@/lib/services/wallet.service';
import { addBreadcrumb, captureException, captureMessage } from '@/lib/observability/sentry';

import {
  allocateNonce,
  releaseInflightNonce,
  scanAndFillGaps,
} from '@/lib/services/nonce-allocator.service';
import {
  SEADROP_ADDRESS,
  SEADROP_MINT_PUBLIC_ABI,
  ZERO_ADDRESS,
  buildSeaDropMintData,
  getSeaDropFeeRecipient,
  isSeaDropMintFunction,
} from '@/lib/services/seadrop.service';
import {
  UNSUPPORTED_MINT_PREFIX,
  buildGenericMintCalldata,
  isMintSignature,
  isUnsupportedMintFunction,
} from '@/lib/services/mint-calldata.service';

// ─── Config ──────────────────────────────────────────


// ─── Types ───────────────────────────────────────────

export interface MintParams {
  contractAddress: Hex;
  mintFunction?: string;
  mintPrice?: string;
  gasLimit?: string;
  quantity: number;
}

export interface MintResult {
  success: boolean;
  txHash?: Hex;
  gasUsed?: string;
  blockNumber?: bigint;
  error?: string;
}

/**
 * Execute the mint transaction on chain.
 *
 * Security invariants (C-1):
 *   - userId is REQUIRED. Anonymous minting is rejected at both the type
 *     level and at runtime.
 *   - walletId is REQUIRED. Missing wallet is rejected before any DB access.
 *   - process.env.PRIVATE_KEY is NEVER consulted. Removed entirely.
 *   - The signing key is resolved exclusively from per-user encrypted storage
 *     via getDecryptedPrivateKey(walletId, userId), which enforces ownership
 *     at the DB layer (wallets.userId = userId predicate).
 *   - Error messages returned to callers are sanitised: they do not expose
 *     walletId values, decryption internals, or stack traces.
 *   - Full diagnostic details are logged server-side via captureException.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown mint error';
}




function buildMintData(params: MintParams): Hex {
  const abi =
    params.mintFunction === 'mint' || !params.mintFunction
      ? parseAbi(['function mint(uint256 quantity) payable'])
      : parseAbi([`function ${params.mintFunction}(uint256 quantity) payable`]);
  return encodeFunctionData({
    abi,
    functionName: params.mintFunction || 'mint',
    args: [BigInt(params.quantity)],
  });
}

// Per-unit mint price in wei (0 when free / unknown).
function unitPriceWei(params: MintParams): bigint {
  return params.mintPrice ? parseEther(params.mintPrice) : BigInt(0);
}

/**
 * Resolve the actual on-chain call (target, calldata, value) for a mint.
 *
 * Standard contracts: call the token's mint(uint256) with msg.value = price.
 * SeaDrop (OpenSea) drops: the token has no payable mint — route through the
 * SeaDrop contract's mintPublic(...) with msg.value = quantity * mintPrice.
 */
async function resolveMintTx(
  address: Hex,
  chain: string,
  params: MintParams,
  userId?: string,
): Promise<{ to: Hex; data: Hex; value: bigint }> {
  if (isSeaDropMintFunction(params.mintFunction)) {
    const feeRecipient = await getSeaDropFeeRecipient(params.contractAddress, chain, userId);
    return {
      to: SEADROP_ADDRESS,
      data: buildSeaDropMintData({ nftContract: params.contractAddress, feeRecipient, quantity: params.quantity }),
      value: unitPriceWei(params) * BigInt(params.quantity),
    };
  }

  // Contracts whose mint mechanism we cannot encode generically (claim w/ proofs,
  // ERC-1155 ids, signatures, …) are blocked rather than guessed.
  if (isUnsupportedMintFunction(params.mintFunction)) {
    throw new Error(
      `UnsupportedMint: this contract's mint function (${params.mintFunction?.replace(UNSUPPORTED_MINT_PREFIX, '')}) ` +
      'needs data AutoMint cannot generate (e.g. allowlist proof, claim conditions, or token id). Mint it manually.',
    );
  }

  // Generic ABI-driven path: stored mintFunction is a full signature, e.g.
  // 'mint(address to, uint256 quantity)'.
  if (isMintSignature(params.mintFunction)) {
    const built = buildGenericMintCalldata(params.mintFunction as string, address, params.quantity);
    if (!built) {
      throw new Error('UnsupportedMint: the mint function arguments could not be encoded safely.');
    }
    return {
      to: params.contractAddress,
      data: built.data,
      value: unitPriceWei(params) * BigInt(built.valueMultiplier),
    };
  }

  // Legacy bare-name path: assume fn(uint256 quantity).
  return {
    to: params.contractAddress,
    data: buildMintData(params),
    value: unitPriceWei(params),
  };
}


// ─── EIP-1559 gas strategy ────────────────────────────────────────────────────
//
// Legacy getGasPrice() returns a single value and cannot distinguish between
// the base fee (burned) and the priority fee (paid to validators). This leads
// to over-paying on quiet blocks and under-paying on congested ones.
//
// EIP-1559 strategy:
//   maxPriorityFeePerGas = user-configured tip (default 1.5 gwei)
//   maxFeePerGas         = baseFee * 2 + priorityFee
//
// The 2× base-fee multiplier gives a two-block buffer against fee spikes.
// Viem will never pay more than maxFeePerGas, so the tx is never over-charged.
//
// Chains that have not adopted EIP-1559 (e.g. Polygon PoS legacy path) will
// return null from getBlock('pending').baseFeePerGas; we fall back to legacy
// gasPrice for those chains.

export interface GasParams {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
}

const DEFAULT_PRIORITY_FEE_GWEI = 1.5; // gwei — paid to validators for inclusion priority

export async function resolveGasParams(
  chain: string,
  userId?: string,
  priorityFeeGwei = DEFAULT_PRIORITY_FEE_GWEI,
): Promise<GasParams> {
  try {
    const client = getClient(chain, userId);
    const block = await client.getBlock({ blockTag: 'pending' });
    const baseFee = block.baseFeePerGas;

    if (baseFee !== null && baseFee !== undefined) {
      // EIP-1559 chain (Ethereum, Base)
      const priorityFee = parseGwei(String(priorityFeeGwei));
      const maxFeePerGas = baseFee * 2n + priorityFee;
      return { maxFeePerGas, maxPriorityFeePerGas: priorityFee };
    }

    // Legacy chain (Polygon PoS or any non-EIP-1559 chain)
    const gasPrice = await client.getGasPrice();
    return { gasPrice };
  } catch (error) {
    await captureException(error, {
      area: 'minting',
      context: { chain },
      fingerprint: ['mint', 'gas-params'],
    });
    // Fallback: return empty object — viem will use its own gas estimation
    return {};
  }
}

/**
 * Estimate gas for the mint transaction.
 */
export async function estimateMintGas(
  address: Hex,
  chain: string,
  params: MintParams,
  userId?: string,
): Promise<{ gasLimit: bigint; error?: string }> {
  try {
    const client = getClient(chain, userId);
    const { to, data, value } = await resolveMintTx(address, chain, params, userId);
    const estimate = await client.estimateGas({
      account: address,
      to,
      data,
      value,
    });
    return { gasLimit: estimate };
  } catch (error) {
    await captureException(error, {
      area: 'minting',
      context: { wallet: address, chain, collection: params.contractAddress },
      fingerprint: ['mint', 'gas-estimation'],
    });
    return { gasLimit: BigInt(0), error: getErrorMessage(error) || 'Gas estimation failed' };
  }
}


// ── Pre-mint simulation (eth_call dry-run) ──────────────────────────────────
//
// Runs simulateContract() before any signing or broadcasting. If the simulation
// reverts, we return a descriptive error immediately — no gas spent, no nonce
// consumed, no MEV exposure.
//
// Known revert reasons we classify:
//   sold_out           — totalSupply reached maxSupply / mint ended
//   price_mismatch     — msg.value < mintPrice
//   paused             — contract is paused / not active
//   wrong_phase        — whitelist/presale phase, public not open
//   not_eligible       — wallet not on allowlist
//   max_per_wallet     — wallet already minted max quantity
//   generic_revert     — any other contract revert
//
// Set SKIP_MINT_SIMULATION=true to bypass (e.g. for contracts with view-
// function bugs that cause false-positive simulation failures).
// ─────────────────────────────────────────────────────────────────────────────

type SimulationResult =
  | { success: true }
  | { success: false; reason: string; revertReason: string };

const REVERT_CLASSIFIERS: Array<[RegExp, string]> = [
  [/sold.?out|max.?supply|supply.?exceeded|minted.?out|no.?remaining/i, 'sold_out'],
  [/insufficient.*value|wrong.*price|incorrect.*price|price.*mismatch|msg\.value/i, 'price_mismatch'],
  [/paused|not.?active|minting.?disabled|mint.?not.?enabled/i, 'paused'],
  [/not.?started|too.?early|before.?mint|presale|allowlist.?only|whitelist.?only|public.?not/i, 'wrong_phase'],
  [/not.*eligible|not.*allowlist|not.*whitelist|not.*allowed/i, 'not_eligible'],
  [/already.?minted|max.*per.*wallet|limit.*reached|exceed.*limit/i, 'max_per_wallet'],
];

function classifyRevert(message: string): string {
  for (const [pattern, label] of REVERT_CLASSIFIERS) {
    if (pattern.test(message)) return label;
  }
  return 'generic_revert';
}

export async function simulateMint(
  address: Hex,
  chain: string,
  params: MintParams,
  userId?: string,
): Promise<SimulationResult> {
  // Escape hatch: skip simulation for contracts with buggy view functions
  if (process.env.SKIP_MINT_SIMULATION === 'true') return { success: true };

  try {
    const client = getClient(chain, userId);

    // SeaDrop (OpenSea) drops simulate mintPublic(...) on the SeaDrop contract
    // with value = quantity * mintPrice — NOT a token-level mint(uint256).
    if (isSeaDropMintFunction(params.mintFunction)) {
      const feeRecipient = await getSeaDropFeeRecipient(params.contractAddress, chain, userId);
      await client.simulateContract({
        address: SEADROP_ADDRESS,
        abi: SEADROP_MINT_PUBLIC_ABI,
        functionName: 'mintPublic',
        args: [params.contractAddress, feeRecipient, ZERO_ADDRESS, BigInt(params.quantity)],
        account: address,
        value: unitPriceWei(params) * BigInt(params.quantity),
      });
      return { success: true };
    }

    // Contracts we can't encode generically: fail simulation with a clear reason
    // so executeMint blocks instead of guessing.
    if (isUnsupportedMintFunction(params.mintFunction)) {
      return { success: false, reason: 'unsupported', revertReason: 'unsupported mint mechanism' };
    }

    // Generic ABI-driven path: dry-run the exact calldata we would broadcast.
    if (isMintSignature(params.mintFunction)) {
      const built = buildGenericMintCalldata(params.mintFunction as string, address, params.quantity);
      if (!built) return { success: false, reason: 'unsupported', revertReason: 'mint args not encodable' };
      await client.call({
        account: address,
        to: params.contractAddress,
        data: built.data,
        value: unitPriceWei(params) * BigInt(built.valueMultiplier),
      });
      return { success: true };
    }

    const abi = params.mintFunction === 'mint' || !params.mintFunction
      ? parseAbi(['function mint(uint256 quantity) payable'])
      : parseAbi([`function ${params.mintFunction}(uint256 quantity) payable`]);

    await client.simulateContract({
      address: params.contractAddress,
      abi,
      functionName: params.mintFunction || 'mint',
      args: [BigInt(params.quantity)],
      account: address,
      value: params.mintPrice ? parseEther(params.mintPrice) : BigInt(0),
    });

    return { success: true };
  } catch (error) {
    // Extract the most useful revert message
    let revertMsg = '';

    if (error instanceof ContractFunctionRevertedError) {
      // Viem parses the ABI-encoded revert reason when it can
      revertMsg = error.reason ?? error.shortMessage ?? error.message ?? '';
    } else if (error instanceof Error) {
      revertMsg = error.message ?? '';
    }

    const reason = classifyRevert(revertMsg);

    addBreadcrumb({
      category: 'simulation',
      message: `Mint simulation failed: ${reason}`,
      level: 'warning',
      data: { chain, contract: params.contractAddress, revertMsg: revertMsg.slice(0, 200), reason },
    });

    return { success: false, reason, revertReason: revertMsg.slice(0, 300) };
  }
}

export async function executeMint(
  address: Hex,
  chain: string,
  params: MintParams,
  userId: string,                 // REQUIRED — was `userId?: string`
  options: {
    walletId: string;          // REQUIRED — wallet to sign with
    privateMempool?: boolean;  // Optional — route via Flashbots/MEV Blocker (Ethereum only)
  },
): Promise<MintResult> {
  // ── Guard: userId is mandatory ───────────────────────────────────
  // Runtime check in addition to the TypeScript type requirement,
  // to defend against JS callers and dynamically-constructed payloads.
  if (!userId || !userId.trim()) {
    return {
      success: false,
      error: 'Mint execution requires an authenticated user.',
    };
  }

  // ── Guard: walletId is mandatory ─────────────────────────────────
  if (!options.walletId || !options.walletId.trim()) {
    return {
      success: false,
      error: 'Mint execution requires a wallet selection.',
    };
  }

  // ── Guard: unsupported mint mechanism ───────────────────────────────────────
  // Block contracts whose mint we cannot encode generically (claim w/ proofs,
  // ERC-1155 ids, signatures, …) before any signing or broadcast.
  if (isUnsupportedMintFunction(params.mintFunction)) {
    return {
      success: false,
      error:
        `UnsupportedMint: this contract's mint function (${params.mintFunction?.replace(UNSUPPORTED_MINT_PREFIX, '')}) ` +
        'needs data AutoMint cannot generate (allowlist proof, claim conditions, or token id). Mint it manually.',
    };
  }

  // ── C-01 Fix: MINT_MODE guard ────────────────────────────────────────────────
  // The test suite asserts that executeMint() must reject execution outside a
  // live production environment unless MINT_MODE='live' is explicitly set.
  // Without this check, a staging or CI environment that contains real encrypted
  // wallet keys would broadcast actual on-chain transactions.
  //
  // In production (NODE_ENV='production'), the deployment itself is the gating
  // signal — MINT_MODE is not required.
  // In all other environments (test, development, CI), set MINT_MODE=live to
  // explicitly opt into real transaction broadcast.
  if (process.env.NODE_ENV !== 'production') {
    const mintMode = process.env.MINT_MODE;
    if (mintMode !== 'live') {
      return {
        success: false,
        error: `MINT_MODE guard: execution blocked in non-production environment (MINT_MODE='${mintMode ?? 'unset'}'). Set MINT_MODE=live to allow real transactions.`,
      };
    }
  }

    try {
    // ── C-03 Fix + Simulation: all run in parallel ──────────────────────────────────────────────────────────────────────────────────────────
    // eth_call simulation, nonce allocation, and EIP-1559 gas params resolve concurrently.
    // This means simulation adds ZERO net latency on live mints — it completes during
    // the same ~100–300ms RPC window as nonce allocation and gas estimation.
    //
    // Sequential simulation (the naive approach) would gate broadcast behind an extra
    // round-trip, adding ~100–300ms per mint — critical when racing bots on a live drop.
    const [simulation, nonceResult, gasParams] = await Promise.all([
      simulateMint(address, chain, params, userId),
      allocateNonce(address, chain).catch(() => null),
      resolveGasParams(chain, userId),
    ]);
    const allocatedNonce: number | undefined = nonceResult?.nonce;

    // Gate on simulation AFTER all three have resolved.
    // Release the inflight nonce if simulation failed so it doesn't create a gap.
    if (!simulation.success) {
      if (nonceResult?.nonce !== undefined) {
        void releaseInflightNonce(address, chain, nonceResult.nonce).catch(() => undefined);
      }
      const labels: Record<string, string> = {
        sold_out: 'Collection is sold out',
        price_mismatch: 'Mint price mismatch — check mintPrice config',
        paused: 'Minting is paused on this contract',
        wrong_phase: 'Public mint not open yet (whitelist/presale phase)',
        not_eligible: 'This wallet is not eligible to mint',
        max_per_wallet: 'This wallet has already reached the per-wallet mint limit',
        generic_revert: 'Contract simulation reverted',
        unsupported: 'Unsupported mint mechanism — needs allowlist proof / claim conditions / token id; mint manually',
      };
      const label = labels[simulation.reason] ?? labels.generic_revert;
      return {
        success: false,
        error: `SimulationFailed: ${label}${simulation.revertReason ? ` — ${simulation.revertReason}` : ''}`,
      };
    }


    // ── Decrypt per-user signing key (deferred until after simulation) ─────────
    // getDecryptedPrivateKey(walletId, userId) enforces ownership at the
    // DB layer: it only returns a key when wallets.id = walletId AND
    // wallets.userId = userId. Cross-user access returns "Wallet not found".
    //
    // Deferring decryption minimises the key's memory window to the sign +
    // broadcast phase (~5–20ms). During the ~100–300ms simulation window the
    // key does not exist in memory. If simulation fails, it is never decrypted.
    let privateKey: Hex;
    try {
      const decrypted = await getDecryptedPrivateKey(options.walletId, userId);
      privateKey = (decrypted.startsWith('0x') ? decrypted : `0x${decrypted}`) as Hex;
    } catch (keyError) {
      // Release the nonce before returning — can't sign without the key.
      if (nonceResult?.nonce !== undefined) {
        void releaseInflightNonce(address, chain, nonceResult.nonce).catch(() => undefined);
      }
      await captureException(keyError, {
        area: 'minting',
        context: { chain, collection: params.contractAddress },
        fingerprint: ['mint', 'key-decryption'],
      });
      const OWNERSHIP_ERROR_PATTERNS = [
        'not found', 'access denied', 'unauthorized',
        'permission denied', 'belongs to another user',
      ];
      const isOwnershipError =
        keyError instanceof Error &&
        OWNERSHIP_ERROR_PATTERNS.some((p) => keyError.message.toLowerCase().includes(p));
      return {
        success: false,
        error: isOwnershipError ? 'Wallet not found or access denied.' : 'Wallet key unavailable.',
      };
    }

    // ── Build and broadcast transaction ──────────────────────────────────────
    // Resolve target + calldata + value (handles SeaDrop routing). For SeaDrop
    // this is sent to the SeaDrop contract with value = quantity * mintPrice.
    const { to: mintTo, data: mintData, value } = await resolveMintTx(address, chain, params, userId);
    const account = privateKeyToAccount(privateKey);
    const walletClient = getWalletClient(chain, account, { userId });

    // C-04: hoist hash before the broadcast try so the catch block can always return it.
    let hash: Hex | undefined;

    try {
      // Speed fix (multi-RPC broadcast racing):
      // 1. Sign the transaction locally — pure crypto, no network call
      // 2. Send the signed bytes to ALL configured RPC providers simultaneously
      // 3. Return the hash from whichever provider responds first
      //
      // This is safe because a signed transaction has a deterministic hash —
      // all providers return the same hash for the same signed bytes.
      // eth_sendRawTransaction is idempotent: duplicate submissions do NOT
      // create duplicate on-chain transactions.
      //
      // TypeScript fix: viem's signTransaction uses a strict discriminated union —
      // EIP-1559 transactions must NOT have a gasPrice key (even as undefined),
      // and legacy transactions must NOT have maxFeePerGas/maxPriorityFeePerGas.
      // We branch into two explicit calls so each path satisfies its union branch.
      const baseTxParams = {
        account,
        chain: getChain(chain),
        to: mintTo,
        data: mintData,
        value,
        gas: params.gasLimit ? BigInt(params.gasLimit) : undefined,
        ...(allocatedNonce !== undefined && { nonce: allocatedNonce }),
      };

      let signedTx: `0x${string}`;
      if (gasParams.maxFeePerGas !== undefined) {
        // EIP-1559 path (Ethereum, Base) — no gasPrice key allowed
        signedTx = await walletClient.signTransaction({
          ...baseTxParams,
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        });
      } else if (gasParams.gasPrice !== undefined) {
        // Legacy path (Polygon PoS or non-EIP-1559 chains) — no EIP-1559 keys allowed
        signedTx = await walletClient.signTransaction({
          ...baseTxParams,
          gasPrice: gasParams.gasPrice,
        });
      } else {
        // resolveGasParams returned {} (error fallback) — let viem estimate gas
        signedTx = await walletClient.signTransaction({ ...baseTxParams });
      }
      // Feature: private mempool routing (Flashbots / MEV Blocker)
      // When options.privateMempool is true and the chain supports it (Ethereum),
      // route via Flashbots Protect → MEV Blocker → public fallback.
      // This prevents frontrunning and sandwich attacks on high-value mints.
      if (options.privateMempool) {
        const { broadcastViaPrivateMempool } = await import('@/lib/services/private-mempool.service');
        const result = await broadcastViaPrivateMempool(chain, signedTx);
        hash = result.txHash;
        addBreadcrumb({
          category: 'mint',
          message: result.isPrivate ? 'Transaction broadcast via private mempool' : 'Private mempool unavailable — used public broadcast',
          level: 'info',
          data: { chain, endpoint: result.endpoint, isPrivate: result.isPrivate },
        });
      } else {
        hash = await broadcastRawTransaction(chain, signedTx, { userId });
      }
    } catch (broadcastError) {
      // sendTransaction itself failed — transaction was never broadcast.
      // Safe to retry; no hash to preserve.
      await captureException(broadcastError, {
        area: 'minting',
        context: { wallet: address, chain, collection: params.contractAddress },
        fingerprint: ['mint', 'broadcast'],
      });
      return {
        success: false,
        error: getErrorMessage(broadcastError) || 'Transaction broadcast failed',
      };
    }

    // Post-broadcast: release inflight tracking and scan for gaps.
    // hash is guaranteed to be defined here.
    if (allocatedNonce !== undefined) {
      void releaseInflightNonce(account.address, chain, allocatedNonce).catch(() => undefined);
      void scanAndFillGaps(account.address, chain).catch(() => undefined);
    }

    // ── Wait for 1 confirmation ─────────────────────────────────────────
    // From this point the transaction is live on-chain. Any error MUST
    // preserve hash so the caller can track the existing tx rather than
    // broadcasting a second one.
    try {
      const client = getClient(chain, userId);
      // Speed fix: set pollingInterval to 500ms (viem default is 4 s on most chains).
      // On Base (2 s blocks) this cuts average confirmation detection from ~4–8 s
      // to ~500–2500 ms. On Ethereum (12 s blocks) it still improves detection to
      // within one polling cycle after the block lands.
      // timeout is set explicitly so long mints don't hang the serverless function.
      const receipt = await client.waitForTransactionReceipt({
        hash,
        pollingInterval: 500,   // ms between receipt polls
        timeout: 90_000,        // 90s hard timeout (was viem default 180s)
      });

      if (receipt.status !== 'success') {
        await captureMessage('Mint transaction reverted', {
          area: 'minting',
          level: 'error',
          context: { wallet: address, chain, collection: params.contractAddress, transactionHash: hash },
          fingerprint: ['mint', 'reverted'],
        });
      }

      return {
        success: receipt.status === 'success',
        txHash: hash,
        gasUsed: receipt.gasUsed?.toString(),
        blockNumber: receipt.blockNumber,
      };
    } catch (receiptError) {
      // waitForTransactionReceipt timed out or failed — but the transaction IS
      // on-chain. Return txHash so the caller transitions to 'unconfirmed'
      // and polls for the receipt without broadcasting a second transaction.
      await captureException(receiptError, {
        area: 'minting',
        context: { wallet: address, chain, collection: params.contractAddress, transactionHash: hash },
        fingerprint: ['mint', 'receipt-timeout'],
      });
      return {
        success: false,
        txHash: hash,
        error: 'receipt_timeout',
      };
    }
  } catch (error) {
    // Catch-all for errors before sendTransaction (key decryption,
    // gas estimation, nonce allocation). No hash exists at this stage.
    await captureException(error, {
      area: 'minting',
      context: { wallet: address, chain, collection: params.contractAddress },
      fingerprint: ['mint', 'execute'],
    });
    return {
      success: false,
      error: getErrorMessage(error) || 'Mint execution failed',
    };
  }
}
