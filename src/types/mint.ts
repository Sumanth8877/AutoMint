/**
 * Shared mint-domain types.
 *
 * Centralises MintPhase so it's defined once and imported everywhere
 * instead of being re-declared in route.ts and mint-discovery.service.ts.
 */

export type MintPhaseType = 'whitelist' | 'allowlist' | 'public';

export interface MintPhase {
  type: MintPhaseType;
  proofRequired?: boolean;
  startTime?: Date;
  price?: string;
}
