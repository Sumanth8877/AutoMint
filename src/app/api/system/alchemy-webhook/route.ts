import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { listMonitoredContracts, registerContractForMonitoring, unregisterContract } from '@/lib/services/alchemy-webhook.service';
import { parseJsonBody } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

/** GET /api/system/alchemy-webhook — list all contracts currently monitored */
export async function GET() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const contracts = await listMonitoredContracts();
  const configured = !!(process.env.ALCHEMY_AUTH_TOKEN && process.env.ALCHEMY_WEBHOOK_ID);

  return NextResponse.json({ configured, contracts, count: contracts.length });
}

/** POST /api/system/alchemy-webhook — manually register a contract */
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await parseJsonBody(req) as { contractAddress?: string };
  if (!body.contractAddress) {
    return NextResponse.json({ error: 'contractAddress is required' }, { status: 400 });
  }

  await registerContractForMonitoring(body.contractAddress);
  return NextResponse.json({ ok: true, registered: body.contractAddress });
}

/** DELETE /api/system/alchemy-webhook — manually unregister a contract */
export async function DELETE(req: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const body = await parseJsonBody(req) as { contractAddress?: string };
  if (!body.contractAddress) {
    return NextResponse.json({ error: 'contractAddress is required' }, { status: 400 });
  }

  await unregisterContract(body.contractAddress);
  return NextResponse.json({ ok: true, unregistered: body.contractAddress });
}
