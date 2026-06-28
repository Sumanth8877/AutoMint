import 'server-only';

import { type Abi, type AbiFunction, type Hex, encodeFunctionData } from 'viem';

/**
 * Generic, ABI-driven mint calldata builder.
 *
 * Standard NFT contracts expose many different mint signatures. Rather than
 * assuming `mint(uint256)`, we read the real ABI (via Etherscan, with proxy
 * resolution) and encode calldata that matches the contract's actual function.
 *
 * SAFETY: we only fill functions whose every argument we can determine with
 * confidence — a single recipient address and/or a single quantity. Anything
 * that needs data we cannot synthesise (merkle proofs, claim conditions,
 * token ids, signatures, prices, tuples, arbitrary bytes) is treated as
 * UNSUPPORTED and the mint is blocked with a clear error instead of guessing.
 * A wrong guess on the money path is unacceptable; the pre-broadcast simulation
 * in executeMint() is a second safety net on top of this.
 */

// Sentinel stored in mintTasks.mintFunction when the contract's mint mechanism
// cannot be encoded generically (e.g. Thirdweb claim w/ proofs, ERC-1155 ids).
export const UNSUPPORTED_MINT_PREFIX = 'unsupported:';

// Mint function names in rough priority order.
const MINT_NAME_PRIORITY = [
  'mint', 'publicMint', 'mintPublic', 'mintTo', 'purchase',
  'claim', 'buy', 'mintNFT', 'saleMint', 'mintWithComment',
];

const ID_NAME_RE = /(^|_|\b)id\b|tokenid|token_id/i;

function isUintType(t: string): boolean {
  return /^uint(\d+)?$/.test(t);
}

/** True when every argument of this function can be safely synthesised. */
export function canFillMintFunction(fn: AbiFunction): boolean {
  let addressCount = 0;
  let quantityCount = 0;
  for (const input of fn.inputs) {
    const t = input.type;
    const name = input.name ?? '';
    if (t === 'address') {
      addressCount += 1;
      if (addressCount > 1) return false; // ambiguous (which address?)
      continue;
    }
    if (isUintType(t)) {
      // A uint that names a token id (ERC-1155 / specific token) is not a quantity.
      if (ID_NAME_RE.test(name)) return false;
      quantityCount += 1;
      if (quantityCount > 1) return false; // e.g. (id, amount) — ambiguous
      continue;
    }
    // bool, bytes, bytes32, string, arrays, tuples (proofs/conditions/signatures) → cannot synthesise
    return false;
  }
  return true;
}

/** Whether the function takes a quantity argument (affects msg.value scaling). */
export function hasQuantityArg(fn: AbiFunction): boolean {
  return fn.inputs.some((i) => isUintType(i.type) && !ID_NAME_RE.test(i.name ?? ''));
}

/** Build positional args: address → recipient wallet, uint → quantity. */
export function fillMintArgs(fn: AbiFunction, walletAddress: Hex, quantity: number): readonly unknown[] | null {
  if (!canFillMintFunction(fn)) return null;
  const args: unknown[] = [];
  for (const input of fn.inputs) {
    if (input.type === 'address') args.push(walletAddress);
    else if (isUintType(input.type)) args.push(BigInt(quantity));
    else return null;
  }
  return args;
}

/** Serialise an AbiFunction to a stable, re-parseable signature with names. */
export function formatMintSignature(fn: AbiFunction): string {
  const params = fn.inputs.map((i) => `${i.type} ${i.name ?? ''}`.trim()).join(', ');
  return `${fn.name}(${params})`;
}

export interface MintFunctionPlan {
  // What to store in mintTasks.mintFunction:
  //  - a full signature like 'mint(address to, uint256 quantity)' (generic path)
  //  - 'unsupported:<name>' when the mechanism can't be encoded
  mintFunction: string;
  supported: boolean;
}

/**
 * Choose the best mint function from an ABI and return what to persist.
 * Prefers a fillable, higher-priority payable function. If the only mint-like
 * functions need data we can't synthesise, returns an UNSUPPORTED plan.
 */
export function planMintFunction(abi: Abi): MintFunctionPlan | null {
  const fns = abi.filter((f): f is AbiFunction => f.type === 'function');
  const payable = fns.filter((f) => f.stateMutability === 'payable');
  // Free mints may be nonpayable; consider those too, but after payable.
  const nonpayable = fns.filter((f) => f.stateMutability === 'nonpayable');

  const byPriority = (list: AbiFunction[]) =>
    [...list].sort((a, b) => {
      const pa = MINT_NAME_PRIORITY.indexOf(a.name);
      const pb = MINT_NAME_PRIORITY.indexOf(b.name);
      return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
    });

  const namedMint = (f: AbiFunction) =>
    MINT_NAME_PRIORITY.includes(f.name) || /mint|claim|purchase|buy/i.test(f.name);

  const candidates = [...byPriority(payable.filter(namedMint)), ...byPriority(nonpayable.filter(namedMint))];
  if (candidates.length === 0) return null;

  // Prefer a fillable candidate.
  const fillable = candidates.find(canFillMintFunction);
  if (fillable) return { mintFunction: formatMintSignature(fillable), supported: true };

  // Mint-like functions exist but need data we can't synthesise.
  return { mintFunction: `${UNSUPPORTED_MINT_PREFIX}${candidates[0].name}`, supported: false };
}

export function isUnsupportedMintFunction(mintFunction?: string | null): boolean {
  return typeof mintFunction === 'string' && mintFunction.startsWith(UNSUPPORTED_MINT_PREFIX);
}

/** A stored mintFunction is a full signature when it contains an argument list. */
export function isMintSignature(mintFunction?: string | null): boolean {
  return typeof mintFunction === 'string' && mintFunction.includes('(') && !isUnsupportedMintFunction(mintFunction);
}

export interface GenericMintCall {
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  data: Hex;
  /** value scaling: 1 when the function has no quantity arg, else `quantity`. */
  valueMultiplier: number;
}

/**
 * Build calldata + value multiplier from a stored signature like
 * 'mint(address to, uint256 quantity)'. Returns null when the function cannot
 * be safely encoded (caller must block the mint).
 */
export function buildGenericMintCalldata(
  signature: string,
  walletAddress: Hex,
  quantity: number,
): GenericMintCall | null {
  try {
    // Manually construct the ABI to avoid viem's parseAbi template-literal
    // type inference issues with dynamic signatures.
    const abi: Abi = [{
      type: 'function',
      name: signature.split('(')[0],
      stateMutability: 'payable',
      inputs: parseSignatureInputs(signature),
      outputs: [],
    }];
    const fn = abi.find((f): f is AbiFunction => f.type === 'function');
    if (!fn) return null;
    const args = fillMintArgs(fn, walletAddress, quantity);
    if (args === null) return null;
    const data = encodeFunctionData({ abi, functionName: fn.name, args });
    return { abi, functionName: fn.name, args, data, valueMultiplier: hasQuantityArg(fn) ? quantity : 1 };
  } catch {
    return null;
  }
}

/** Parse 'mint(address to, uint256 quantity)' into viem AbiInput[]. */
function parseSignatureInputs(signature: string): AbiFunction['inputs'] {
  const paren = signature.indexOf('(');
  if (paren === -1) return [];
  const inner = signature.slice(paren + 1, signature.lastIndexOf(')'));
  if (!inner.trim()) return [];
  return inner.split(',').map((part) => {
    const trimmed = part.trim();
    // Split on last whitespace to separate type from name
    const space = trimmed.lastIndexOf(' ');
    const type = space === -1 ? trimmed : trimmed.slice(0, space);
    const name = space === -1 ? '' : trimmed.slice(space + 1);
    return { type, name } as AbiFunction['inputs'][number];
  });
}
