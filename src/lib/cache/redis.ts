import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

export const CACHE_KEYS = {
  walletBalance: (address: string, chain: string) => `balance:${chain}:${address}`,
  collectionMetadata: (address: string, chain: string) => `collection:${chain}:${address}`,
  mintStatus: (address: string, chain: string) => `mint-status:${chain}:${address}`,
  dashboardStats: (userId: string) => `dashboard:${userId}`,
  floorPrice: (address: string, chain: string) => `floor:${chain}:${address}`,
};

export const CACHE_TTL = {
  walletBalance: 300, // 5 minutes
  collectionMetadata: 3600, // 1 hour
  mintStatus: 30, // 30 seconds
  dashboardStats: 300, // 5 minutes
  floorPrice: 600, // 10 minutes
} as const;