import 'server-only';
import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';

export const dynamic = 'force-dynamic';

export type ServiceStatus = {
  name: string;
  configured: boolean;
};

export type UsageResponse = {
  services: ServiceStatus[];
  fetchedAt: string;
};

function check(key: string): boolean {
  return Boolean(process.env[key]);
}

export async function GET() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const services: ServiceStatus[] = [
    // Core
    { name: 'Upstash Redis',     configured: check('KV_REST_API_URL') || check('UPSTASH_REDIS_REST_URL') },
    { name: 'QStash',            configured: check('QSTASH_TOKEN') },
    { name: 'Neon (Postgres)',   configured: check('DATABASE_URL') },
    { name: 'Vercel',            configured: true }, // always deployed on Vercel
    // Auth & Comms
    { name: 'Clerk',             configured: check('CLERK_SECRET_KEY') },
    { name: 'Telegram Bot',      configured: check('TELEGRAM_BOT_TOKEN') },
    { name: 'Resend',            configured: check('RESEND_API_KEY') },
    { name: 'Sentry',            configured: check('NEXT_PUBLIC_SENTRY_DSN') },
    // Blockchain RPC
    { name: 'Alchemy',           configured: check('ALCHEMY_API_KEY') },
    { name: 'Infura',            configured: check('INFURA_API_KEY') },
    { name: 'Chainstack',        configured: check('CHAINSTACK_API_KEY') },
    { name: 'Etherscan',         configured: check('ETHERSCAN_API_KEY') },
    // AI / Scraping
    { name: 'Gemini AI',         configured: check('GEMINI_API_KEY') },
    { name: 'Jina AI',           configured: check('JINA_API_KEY') },
    { name: 'Firecrawl',         configured: check('FIRECRAWL_API_KEY') },
    { name: 'Browserbase',       configured: check('BROWSERBASE_API_KEY') },
    // NFT Data
    { name: 'OpenSea',           configured: check('OPENSEA_API_KEY') },
    { name: 'Moralis',           configured: check('MORALIS_API_KEY') },
    { name: 'NFTScan',           configured: check('NFTSCAN_API_KEY') },
    { name: 'Dune Analytics',    configured: check('DUNE_API_KEY') },
    // Security
    { name: 'GoPlus Security',   configured: check('GOPLUS_API_KEY') },
  ];

  return NextResponse.json({ services, fetchedAt: new Date().toISOString() } satisfies UsageResponse);
}
