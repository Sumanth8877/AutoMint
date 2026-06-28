import 'server-only';

import { getClient } from '@/lib/blockchain/client';
import { addBreadcrumb } from '@/lib/observability/sentry';
import { logger } from '@/lib/logger';
import type { Hex } from 'viem';
import {
  SEADROP_ADDRESS,
  SEADROP_MINT_PUBLIC_ABI,
  ZERO_ADDRESS,
  getSeaDropFeeRecipient,
  isSeaDropMintFunction,
} from '@/lib/services/seadrop.service';
import {
  buildGenericMintCalldata,
  isMintSignature,
  isUnsupportedMintFunction,
} from '@/lib/services/mint-calldata.service';

/**
 * honeypot.service.ts
 *
 * On-chain honeypot detection via viem's simulateContract.
 *
 * A honeypot contract accepts the mint TX but reverts on transfer,
 * or the mint function itself reverts with a trap error.
 *
 * Strategy:
 *   1. Call simulateContract with the mint function + expected callvalue
 *   2. If simulation reverts → flag as likely honeypot (or wrong params)
 *   3. If simulation succeeds → proceed with real TX
 *
 * This runs BEFORE the real transaction is submitted, costing zero gas.
 * Falls back gracefully if ABI is unavailable or simulation times out.
 *
 * Note: simulateContract catches revert-style honeypots. Transfer-lock
 * honeypots (tokens that can't be moved post-mint) require a separate
 * transfer simulation which is out of scope here.
 */

export interface HoneypotCheckResult {
  isSafe:    boolean;         // true = simulation passed, proceed with mint
  reason?:   string;         // human-readable reason if isSafe is false
  skipped?:  boolean;        // true = check was skipped (env flag or no ABI)
  gasUsed?:  bigint;         // estimated gas from simulation (reuse in TX)
}

const MINT_ABI_VARIANTS = [
  // Standard ERC721 mint functions — covers ~90% of collections
  { name: 'mint',             inputs: [] },
  { name: 'mint',             inputs: [{ name: 'quantity', type: 'uint256' }] },
  { name: 'publicMint',       inputs: [] },
  { name: 'publicMint',       inputs: [{ name: 'quantity', type: 'uint256' }] },
  { name: 'claim',            inputs: [{ name: 'quantity', type: 'uint256' }] },
  { name: 'mintPublic',       inputs: [{ name: 'quantity', type: 'uint256' }] },
] as const;

/**
 * Simulate the mint function on-chain and report whether the contract
 * behaves like a honeypot.
 */
export async function checkHoneypot(params: {
  contractAddress: string;
  chain:           string;
  mintFunction:    string;       // e.g. 'mint', 'publicMint'
  mintPrice:       string;       // ETH as decimal string e.g. '0.05'
  quantity:        number;
  walletAddress:   string;
}): Promise<HoneypotCheckResult> {

  // Respect the existing SKIP_MINT_SIMULATION flag
  if (process.env.SKIP_MINT_SIMULATION === 'true') {
    return { isSafe: true, skipped: true, reason: 'Simulation disabled via SKIP_MINT_SIMULATION' };
  }

  const { contractAddress, chain, mintFunction, mintPrice, quantity, walletAddress } = params;

  try {
    const client = getClient(chain);
    const value = BigInt(Math.round(parseFloat(mintPrice) * 1e18)) * BigInt(quantity);

    // SeaDrop (OpenSea) drops mint via the SeaDrop contract's mintPublic(...),
    // not a token-level mint(). Simulate the correct call so a valid SeaDrop
    // drop is not falsely flagged as a honeypot.
    if (isSeaDropMintFunction(mintFunction)) {
      const feeRecipient = await getSeaDropFeeRecipient(contractAddress, chain);
      await client.simulateContract({
        address:      SEADROP_ADDRESS,
        abi:          SEADROP_MINT_PUBLIC_ABI,
        functionName: 'mintPublic',
        args:         [contractAddress as Hex, feeRecipient, ZERO_ADDRESS, BigInt(quantity)],
        value,
        account:      walletAddress as Hex,
      });
      addBreadcrumb({
        category: 'honeypot',
        message:  'SeaDrop simulation passed — contract appears safe',
        level:    'info',
        data: { contractAddress, chain, mintFunction, mintPrice, quantity },
      });
      return { isSafe: true };
    }

    // Mechanisms we can't encode generically are validated/blocked at execution
    // time — skip the honeypot simulation rather than false-flagging.
    if (isUnsupportedMintFunction(mintFunction)) {
      return { isSafe: true, skipped: true, reason: 'Unsupported mint mechanism — validated at execution' };
    }

    // Generic ABI-driven path: simulate the exact calldata we would broadcast.
    if (isMintSignature(mintFunction)) {
      const built = buildGenericMintCalldata(mintFunction, walletAddress as Hex, quantity);
      if (!built) {
        return { isSafe: true, skipped: true, reason: 'Mint args not encodable — validated at execution' };
      }
      const unitWei = BigInt(Math.round(parseFloat(mintPrice) * 1e18));
      await client.call({
        account: walletAddress as Hex,
        to:      contractAddress as Hex,
        data:    built.data,
        value:   unitWei * BigInt(built.valueMultiplier),
      });
      addBreadcrumb({
        category: 'honeypot',
        message:  'Generic simulation passed — contract appears safe',
        level:    'info',
        data: { contractAddress, chain, mintFunction, mintPrice, quantity },
      });
      return { isSafe: true };
    }

    // Find the ABI variant matching the stored function name
    const abiEntry = MINT_ABI_VARIANTS.find(v => v.name === mintFunction)
      ?? MINT_ABI_VARIANTS.find(v => v.name === 'mint')!;

    const abi = [{
      type: 'function' as const,
      name: abiEntry.name,
      stateMutability: 'payable' as const,
      inputs: abiEntry.inputs as unknown as { name: string; type: string }[],
      outputs: [],
    }];

    const _callArgs = abiEntry.inputs.length > 0
      ? { args: [BigInt(quantity)] }
      : {};

    // Use a broad any-typed ABI to avoid complex Viem generic inference.
    // We only care about whether it reverts, not the return value.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const simParams: any = {
      address:      contractAddress as Hex,
      abi,
      functionName: abiEntry.name,
      value,
      account:      walletAddress as Hex,
    };
    if (abiEntry.inputs.length > 0) simParams.args = [BigInt(quantity)];

    const { request } = await client.simulateContract(simParams);

    addBreadcrumb({
      category: 'honeypot',
      message:  'Simulation passed — contract appears safe',
      level:    'info',
      data: { contractAddress, chain, mintFunction, mintPrice, quantity },
    });

    return { isSafe: true, gasUsed: request.gas };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isRevert = message.includes('revert') || message.includes('reverted')
      || message.includes('execution reverted') || message.includes('ContractFunctionRevertedError');

    if (isRevert) {
      logger.info('Honeypot check: simulation reverted — potential honeypot or wrong params', {
        area: 'honeypot',
        contractAddress,
        chain,
        mintFunction,
        mintPrice,
        error: message,
      });

      return {
        isSafe: false,
        reason: `Mint simulation reverted: ${message.slice(0, 200)}`,
      };
    }

    // Non-revert error (network timeout, ABI mismatch, etc.) — skip check, don't block
    addBreadcrumb({
      category: 'honeypot',
      message:  'Simulation skipped due to non-revert error',
      level:    'warning',
      data: { contractAddress, chain, error: message },
    });

    return { isSafe: true, skipped: true, reason: `Simulation skipped: ${message.slice(0, 100)}` };
  }
}
