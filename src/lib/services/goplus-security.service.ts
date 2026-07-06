import 'server-only';

import { logger } from '@/lib/logger';

// Fix #3: this service previously called GoPlus Labs' fungible-token
// (ERC-20) security endpoint (`/api/v1/token_security/{chainId}`) against
// NFT contract addresses. That endpoint's schema (buy_tax, sell_tax,
// lp_holders, is_in_dex, etc.) is built around DEX-tradeable tokens with
// tax/liquidity-pool mechanics — it has no concept of an NFT contract and
// most real NFT collections return no data from it, silently disabling the
// entire GoPlus contribution to risk scoring.
//
// This now calls the dedicated NFT Security API instead:
//   GET https://api.gopluslabs.io/api/v1/nft_security/{chain_id}?contract_addresses=...
// Response fields below are the ones GoPlus documents for NFT contracts
// (docs.gopluslabs.io/reference/getnftinfousingget_1 + response-details
// pages): open-source status, malicious-contract/behavior flags, and the
// NFT-specific privileged-operation risk flags (privileged minting,
// transfer-without-approval, self-destruct, oversupply minting). GoPlus's
// schema does evolve, so treat every field as optional and re-verify against
// a live response if GoPlus changes their API.

type GoPlusNftSecurityResponse = {
  code: number;
  result?: Record<string, GoPlusNftSecurity>;
  message?: string;
};

type GoPlusNftSecurity = {
  nft_address?: string;
  nft_name?: string;
  nft_symbol?: string;
  nft_erc?: string;
  creator_address?: string;
  deployed_time?: string;
  is_open_source?: string;             // '1' | '0'
  malicious_nft_contract?: string;     // '1' | '0'
  malicious_address?: string;          // some GoPlus responses use this key instead
  malicious_behavior?: string[];
  privileged_minting?: string;         // '1' | '0' — owner/creator can mint arbitrarily
  transfer_without_approval?: string;  // '1' | '0' — NFTs movable without owner approval
  self_destruct?: string;              // '1' | '0'
  oversupply_minting?: string;         // '1' | '0' — supply cap can be bypassed
  trust_list?: string;                 // '1' | '0'
  same_nfts?: string;                  // '1' | '0' — near-duplicate of a known collection
};

type GoPlusNftSecurityResult = {
  isOpenSource: boolean;
  isMaliciousContract: boolean;
  maliciousBehaviors: string[];
  privilegedMinting: boolean;
  transferWithoutApproval: boolean;
  selfDestruct: boolean;
  oversupplyMinting: boolean;
  trustList: boolean;
  riskScore: number;
  riskFactors: string[];
};

const CHAIN_ID_MAP: Record<string, string> = {
  ethereum: '1',
  base: '8453',
  polygon: '137',
  bsc: '56',
  arbitrum: '42161',
  optimism: '10',
  avalanche: '43114',
  fantom: '250',
  moonbeam: '1284',
};

function getChainId(chain: string): string {
  return CHAIN_ID_MAP[chain.toLowerCase()] || chain;
}

function parseBoolean(value: string | undefined): boolean {
  return value === '1';
}

function calculateGoPlusNftRiskScore(data: GoPlusNftSecurity): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  // Critical risks — contract-level red flags for NFTs
  if (parseBoolean(data.malicious_nft_contract) || parseBoolean(data.malicious_address)) {
    score += 40;
    factors.push('GoPlus: NFT contract flagged as malicious');
  }
  if (parseBoolean(data.self_destruct)) {
    score += 35;
    factors.push('GoPlus: Contract can self-destruct');
  }
  if (parseBoolean(data.transfer_without_approval)) {
    score += 30;
    factors.push('GoPlus: NFTs can be transferred without owner approval');
  }

  // High risks
  if (parseBoolean(data.privileged_minting)) {
    score += 20;
    factors.push('GoPlus: Privileged/unrestricted minting detected');
  }
  if (parseBoolean(data.oversupply_minting)) {
    score += 20;
    factors.push('GoPlus: Supply cap can be bypassed (oversupply minting)');
  }
  if (parseBoolean(data.same_nfts)) {
    score += 10;
    factors.push('GoPlus: Contract closely matches a known/duplicated collection');
  }
  if (Array.isArray(data.malicious_behavior) && data.malicious_behavior.length > 0) {
    score += 15;
    factors.push(`GoPlus: Malicious behavior detected — ${data.malicious_behavior.join(', ')}`);
  }

  // Medium/low risks
  if (data.is_open_source === '0') {
    score += 8;
    factors.push('GoPlus: Contract source code not verified');
  }
  if (data.trust_list === '0') {
    score += 3;
    factors.push('GoPlus: Contract not in GoPlus trust list');
  }

  return { score: Math.min(score, 100), factors };
}

/**
 * Checks NFT-specific contract security via GoPlus Labs' NFT Security API.
 * Kept the name `checkTokenSecurity` (rather than renaming) so existing
 * callers (risk.service.ts, analyzer-data.service.ts) don't need signature
 * changes beyond the result shape — only the endpoint and response fields
 * changed.
 */
export async function checkTokenSecurity(params: {
  contractAddress: string;
  chain: string;
}): Promise<GoPlusNftSecurityResult | null> {
  const apiKey = process.env.GOPLUS_API_KEY;
  if (!apiKey) {
    logger.warn('GoPlus API key not found, skipping security check');
    return null;
  }

  const chainId = getChainId(params.chain);
  const url = `https://api.gopluslabs.io/api/v1/nft_security/${chainId}?contract_addresses=${params.contractAddress}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error(`GoPlus NFT Security API failed with status ${response.status}`);
      return null;
    }

    const data: GoPlusNftSecurityResponse = await response.json();

    if (data.code !== 1 || !data.result) {
      logger.error(`GoPlus NFT Security API returned error: ${data.message}`);
      return null;
    }

    const nftData = data.result[params.contractAddress.toLowerCase()];
    if (!nftData) {
      logger.error(`GoPlus NFT Security API did not return data for contract ${params.contractAddress}`);
      return null;
    }

    const { score: riskScore, factors: riskFactors } = calculateGoPlusNftRiskScore(nftData);

    return {
      isOpenSource: parseBoolean(nftData.is_open_source),
      isMaliciousContract: parseBoolean(nftData.malicious_nft_contract) || parseBoolean(nftData.malicious_address),
      maliciousBehaviors: nftData.malicious_behavior ?? [],
      privilegedMinting: parseBoolean(nftData.privileged_minting),
      transferWithoutApproval: parseBoolean(nftData.transfer_without_approval),
      selfDestruct: parseBoolean(nftData.self_destruct),
      oversupplyMinting: parseBoolean(nftData.oversupply_minting),
      trustList: parseBoolean(nftData.trust_list),
      riskScore,
      riskFactors,
    };
  } catch (error) {
    logger.error('GoPlus NFT Security check failed:', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function checkMultipleTokenSecurity(params: {
  contractAddresses: string[];
  chain: string;
}): Promise<Map<string, GoPlusNftSecurityResult>> {
  const results = new Map<string, GoPlusNftSecurityResult>();

  for (const address of params.contractAddresses) {
    const result = await checkTokenSecurity({ contractAddress: address, chain: params.chain });
    if (result) {
      results.set(address, result);
    }
  }

  return results;
}
