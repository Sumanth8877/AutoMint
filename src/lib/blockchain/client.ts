import 'server-only';

import { getPublicClient } from '@/lib/services/rpc-manager.service';

export function getClient(chain: string) {
  return getPublicClient(chain);
}
