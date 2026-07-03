import { NextResponse } from 'next/server';
import { renderEmailTemplate } from '@/lib/email-templates';

const SAMPLE_DETAILS = {
  taskName: 'Mint Task abc12345',
  collectionName: 'Azuki Elementals',
  chain: 'ethereum',
  timestamp: new Date().toISOString(),
  status: 'Completed',
  contractAddress: '0x1234...abcd',
  txHash: '0xdeadbeef...1234',
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') ?? 'mintSuccess') as 'mintScheduled' | 'mintSuccess' | 'mintFailed' | 'systemErrors';

  const headings: Record<string, [string, string]> = {
    mintScheduled: ['Mint Scheduled', 'Your mint task has been successfully scheduled.'],
    mintSuccess:   ['Mint Success', 'Mint completed successfully.'],
    mintFailed:    ['Mint Failed', 'Mint execution failed.'],
    systemErrors:  ['System Error', 'A user-relevant AutoMint system error affected a task.'],
  };

  const [heading, preview] = headings[type] ?? headings.mintSuccess;
  const details = { ...SAMPLE_DETAILS, status: heading, reason: type === 'mintFailed' ? 'Insufficient gas balance' : undefined };

  const html = renderEmailTemplate(type, heading, preview, details);

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
