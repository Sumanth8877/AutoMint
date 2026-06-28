import { getClient } from '@/lib/blockchain/client';
import { type Hex, parseAbi, encodeFunctionData, getAddress } from 'viem';

/**
 * OpenSea SeaDrop support.
 *
 * The vast majority of NFTs minted *through OpenSea* are SeaDrop drops. They do
 * NOT expose a payable `mint(uint256)` on the token contract — the token's
 * `mintSeaDrop(address,uint256)` is `onlyAllowedSeaDrop` and the BUYER instead
 * calls `mintPublic(...)` on the canonical SeaDrop contract, which pays the
 * creator + OpenSea fee and calls back into the token.
 *
 * That is why naive `publicMintPrice()` / `mint()` handling fails for OpenSea
 * collections: the price has no token-level getter (it lives in SeaDrop's
 * PublicDrop config) and the mint must be routed through SeaDrop.
 *
 * SeaDrop v1 is deployed at the same CREATE2 address across EVM chains.
 */
export const SEADROP_ADDRESS = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5' as Hex;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;

// OpenSea's canonical fee recipient — allowed on OpenSea-created drops. Used as a
// fallback when getAllowedFeeRecipients() cannot be read.
export const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1f0df003000390027140000faa719' as Hex;

// Sentinel stored in mintTasks.mintFunction so the executor routes via SeaDrop
// instead of encoding a token-level mint(uint256). Kept as a plain string so no
// DB migration is needed (mint_function is already a text column).
export const SEADROP_MINT_FUNCTION = 'seaDropMintPublic';

export function isSeaDropMintFunction(mintFunction?: string | null): boolean {
  return mintFunction === SEADROP_MINT_FUNCTION;
}

const SEADROP_ABI = parseAbi([
  'function getPublicDrop(address nftContract) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
  'function getAllowedFeeRecipients(address nftContract) view returns (address[])',
  'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable',
]);

export interface SeaDropPublicDrop {
  mintPriceWei: bigint;
  mintPriceEth: string;   // decimal ETH string, e.g. '0.001000'
  startTime?: Date;
  endTime?: Date;
  maxPerWallet?: number;
  feeBps: number;
  restrictFeeRecipients: boolean;
}

/**
 * Read the SeaDrop public-drop config for a token contract. Returns null when
 * the contract is not a SeaDrop drop (the call reverts) — callers treat null as
 * "not a SeaDrop", never as a free mint.
 */
export async function getSeaDropPublicDrop(
  nftContract: string,
  chain: string,
  userId?: string,
): Promise<SeaDropPublicDrop | null> {
  try {
    const client = getClient(chain, userId);
    const drop = await client.readContract({
      address: SEADROP_ADDRESS,
      abi: SEADROP_ABI,
      functionName: 'getPublicDrop',
      args: [getAddress(nftContract)],
    });

    // A non-SeaDrop contract that happens not to revert returns an all-zero
    // struct; treat a zero start AND zero end as "no public drop configured".
    if (drop.startTime === 0 && drop.endTime === 0) return null;

    return {
      mintPriceWei: drop.mintPrice,
      mintPriceEth: (Number(drop.mintPrice) / 1e18).toFixed(6),
      startTime: drop.startTime ? new Date(Number(drop.startTime) * 1000) : undefined,
      endTime: drop.endTime ? new Date(Number(drop.endTime) * 1000) : undefined,
      maxPerWallet: drop.maxTotalMintableByWallet || undefined,
      feeBps: drop.feeBps,
      restrictFeeRecipients: drop.restrictFeeRecipients,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a usable fee recipient for a SeaDrop mint. When fee recipients are
 * restricted we must pass one of the allowed addresses; we prefer the first
 * allowed recipient and fall back to OpenSea's canonical recipient.
 */
export async function getSeaDropFeeRecipient(
  nftContract: string,
  chain: string,
  userId?: string,
): Promise<Hex> {
  try {
    const client = getClient(chain, userId);
    const recipients = await client.readContract({
      address: SEADROP_ADDRESS,
      abi: SEADROP_ABI,
      functionName: 'getAllowedFeeRecipients',
      args: [getAddress(nftContract)],
    });
    if (Array.isArray(recipients) && recipients.length > 0) return recipients[0] as Hex;
  } catch {
    // fall through to the canonical OpenSea recipient
  }
  return OPENSEA_FEE_RECIPIENT;
}

/**
 * Encode the SeaDrop `mintPublic` calldata. The buyer (msg.sender) is both
 * payer and minter, so minterIfNotPayer is the zero address (tokens go to the
 * payer). The transaction must be sent to SEADROP_ADDRESS with
 * value = quantity * mintPrice.
 */
export function buildSeaDropMintData(params: {
  nftContract: string;
  feeRecipient: Hex;
  quantity: number;
}): Hex {
  return encodeFunctionData({
    abi: SEADROP_ABI,
    functionName: 'mintPublic',
    args: [getAddress(params.nftContract), params.feeRecipient, ZERO_ADDRESS, BigInt(params.quantity)],
  });
}

export const SEADROP_MINT_PUBLIC_ABI = SEADROP_ABI;
