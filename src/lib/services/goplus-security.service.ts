import 'server-only';

import { captureException } from '@/lib/observability/sentry';
import { logger } from '@/lib/logger';

type GoPlusTokenSecurityResponse = {
  code: number;
  result?: Record<string, GoPlusTokenSecurity>;
  message?: string;
};

type GoPlusTokenSecurity = {
  token_address: string;
  token_name: string;
  token_symbol: string;
  chainId: string;
  contract_type: string;
  contract_creator: string;
  contract_deploy_tx: string;
  owner_balance: string;
  owner_percentage: string;
  is_honeypot: string;
  is_open_source: string;
  is_proxy: string;
  proxy_imp: string;
  honeypot_with_same_creator: string;
  buy_tax: string;
  sell_tax: string;
  buy_gas: string;
  sell_gas: string;
  slippage: string;
  cannot_buy: string;
  cannot_sell_all: string;
  transfer_pausable: string;
  owner_can_change_balance: string;
  is_anti_whale: string;
  is_blacklisted: string;
  is_in_dex: string;
  is_true_token: string;
  confidence: string;
  trust_list: string;
  audit: string;
  is_mintable: string;
  is_trading_cooldown: string;
  is_anti_whale_enabled: string;
  take_ownership_back: string;
  personal_slippage: string;
  is_hidden_owner: string;
  lp_holders: string;
  lp_holder_count: string;
  lp_total_supply: string;
  lp_balance: string;
  lp_token_name: string;
  lp_token_symbol: string;
  lp_holder_percent: string;
  lp_holder_address: string;
  lp_holder_balance: string;
  lp_holder_txs: string;
  lp_holder_age: string;
  is_airdrop_scam: string;
  token_abi: string;
  holder_count: string;
};

type GoPlusSecurityResult = {
  isHoneypot: boolean;
  isOpenSource: boolean;
  isProxy: boolean;
  buyTax: number;
  sellTax: number;
  cannotBuy: boolean;
  cannotSell: boolean;
  isBlacklisted: boolean;
  isMintable: boolean;
  isTradingCooldown: boolean;
  isAirdropScam: boolean;
  confidence: number;
  trustList: boolean;
  audit: string;
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

function parseBoolean(value: string): boolean {
  return value === '1';
}

function parseNumber(value: string): number {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function calculateGoPlusRiskScore(data: GoPlusTokenSecurity): number {
  let score = 0;
  const factors: string[] = [];

  // Critical risks (high points)
  if (data.is_honeypot === '1') {
    score += 50;
    factors.push('Honeypot detected - token cannot be sold');
  }
  if (data.cannot_buy === '1') {
    score += 40;
    factors.push('Cannot buy token');
  }
  if (data.cannot_sell_all === '1') {
    score += 35;
    factors.push('Cannot sell all tokens');
  }
  if (data.is_airdrop_scam === '1') {
    score += 30;
    factors.push('Airdrop scam detected');
  }
  if (data.is_blacklisted === '1') {
    score += 25;
    factors.push('Token is blacklisted');
  }

  // High risks (medium points)
  if (data.buy_tax && parseNumber(data.buy_tax) > 20) {
    score += 15;
    factors.push(`High buy tax: ${data.buy_tax}%`);
  }
  if (data.sell_tax && parseNumber(data.sell_tax) > 20) {
    score += 15;
    factors.push(`High sell tax: ${data.sell_tax}%`);
  }
  if (data.is_mintable === '1') {
    score += 10;
    factors.push('Token is mintable (inflation risk)');
  }
  if (data.is_trading_cooldown === '1') {
    score += 10;
    factors.push('Trading cooldown enabled');
  }
  if (data.owner_can_change_balance === '1') {
    score += 15;
    factors.push('Owner can change user balances');
  }
  if (data.transfer_pausable === '1') {
    score += 10;
    factors.push('Transfers can be paused');
  }

  // Medium risks (low points)
  if (data.is_open_source === '0') {
    score += 8;
    factors.push('Contract source code not verified');
  }
  if (data.is_proxy === '1' && data.proxy_imp === '1') {
    score += 5;
    factors.push('Proxy contract with implementation risk');
  }
  if (data.is_anti_whale === '1') {
    score += 5;
    factors.push('Anti-whale mechanism enabled');
  }
  if (data.is_hidden_owner === '1') {
    score += 5;
    factors.push('Hidden owner detected');
  }
  if (data.honeypot_with_same_creator && parseNumber(data.honeypot_with_same_creator) > 0) {
    score += 10;
    factors.push(`Creator has ${data.honeypot_with_same_creator} honeypot tokens`);
  }

  // Low risks (very low points)
  if (!data.audit || data.audit === '0') {
    score += 3;
    factors.push('No audit information available');
  }
  if (data.trust_list === '0') {
    score += 3;
    factors.push('Token not in trust list');
  }

  return Math.min(score, 100);
}

export async function checkTokenSecurity(params: {
  contractAddress: string;
  chain: string;
}): Promise<GoPlusSecurityResult | null> {
  const apiKey = process.env.GOPLUS_API_KEY;
  if (!apiKey) {
    logger.warn('GoPlus API key not found, skipping security check');
    return null;
  }

  const chainId = getChainId(params.chain);
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${params.contractAddress}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error(`GoPlus API failed with status ${response.status}`);
      return null;
    }

    const data: GoPlusTokenSecurityResponse = await response.json();

    if (data.code !== 1 || !data.result) {
      logger.error(`GoPlus API returned error: ${data.message}`);
      return null;
    }

    const tokenData = data.result[params.contractAddress.toLowerCase()];
    if (!tokenData) {
      logger.error(`GoPlus API did not return data for contract ${params.contractAddress}`);
      return null;
    }

    const riskScore = calculateGoPlusRiskScore(tokenData);
    const riskFactors: string[] = [];

    // Extract risk factors from the score calculation
    if (tokenData.is_honeypot === '1') riskFactors.push('Honeypot detected');
    if (tokenData.cannot_buy === '1') riskFactors.push('Cannot buy token');
    if (tokenData.cannot_sell_all === '1') riskFactors.push('Cannot sell all tokens');
    if (tokenData.is_airdrop_scam === '1') riskFactors.push('Airdrop scam');
    if (tokenData.is_blacklisted === '1') riskFactors.push('Blacklisted token');
    if (tokenData.buy_tax && parseNumber(tokenData.buy_tax) > 20) riskFactors.push(`High buy tax: ${tokenData.buy_tax}%`);
    if (tokenData.sell_tax && parseNumber(tokenData.sell_tax) > 20) riskFactors.push(`High sell tax: ${tokenData.sell_tax}%`);
    if (tokenData.is_mintable === '1') riskFactors.push('Mintable token');
    if (tokenData.is_trading_cooldown === '1') riskFactors.push('Trading cooldown');
    if (tokenData.owner_can_change_balance === '1') riskFactors.push('Owner can change balances');
    if (tokenData.transfer_pausable === '1') riskFactors.push('Transfers pausable');
    if (tokenData.is_open_source === '0') riskFactors.push('Source code not verified');
    if (tokenData.is_proxy === '1') riskFactors.push('Proxy contract');
    if (tokenData.is_anti_whale === '1') riskFactors.push('Anti-whale mechanism');
    if (tokenData.is_hidden_owner === '1') riskFactors.push('Hidden owner');
    if (tokenData.honeypot_with_same_creator && parseNumber(tokenData.honeypot_with_same_creator) > 0) {
      riskFactors.push(`Creator has ${tokenData.honeypot_with_same_creator} honeypots`);
    }

    return {
      isHoneypot: parseBoolean(tokenData.is_honeypot),
      isOpenSource: parseBoolean(tokenData.is_open_source),
      isProxy: parseBoolean(tokenData.is_proxy),
      buyTax: parseNumber(tokenData.buy_tax || '0'),
      sellTax: parseNumber(tokenData.sell_tax || '0'),
      cannotBuy: parseBoolean(tokenData.cannot_buy),
      cannotSell: parseBoolean(tokenData.cannot_sell_all),
      isBlacklisted: parseBoolean(tokenData.is_blacklisted),
      isMintable: parseBoolean(tokenData.is_mintable),
      isTradingCooldown: parseBoolean(tokenData.is_trading_cooldown),
      isAirdropScam: parseBoolean(tokenData.is_airdrop_scam),
      confidence: parseNumber(tokenData.confidence || '0'),
      trustList: parseBoolean(tokenData.trust_list),
      audit: tokenData.audit || '0',
      riskScore,
      riskFactors,
    };
  } catch (error) {
    logger.error('GoPlus Security check failed:', { error: error instanceof Error ? error.message : String(error) });
    void captureException(error, { area: 'goplus-security' });
    return null;
  }
}

export async function checkMultipleTokenSecurity(params: {
  contractAddresses: string[];
  chain: string;
}): Promise<Map<string, GoPlusSecurityResult>> {
  const results = new Map<string, GoPlusSecurityResult>();

  for (const address of params.contractAddresses) {
    const result = await checkTokenSecurity({ contractAddress: address, chain: params.chain });
    if (result) {
      results.set(address, result);
    }
  }

  return results;
}
