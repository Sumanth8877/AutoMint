import 'server-only';

import {
  closeBrowserSession,
  createBrowserSession,
  getBrowserbaseProjectId,
  isBrowserbaseConfigured,
  openPage,
} from '@/lib/browserbase/client';
import { extractDiscoveryFields, type DiscoveryProviderResult } from '@/lib/services/jina.provider';

export async function discoverWithBrowserbase(
  url: string,
  log?: (message: string) => void,
): Promise<DiscoveryProviderResult> {
  if (!isBrowserbaseConfigured()) {
    log?.('Browserbase failed: not configured');
    throw new Error('Browserbase is not configured');
  }

  log?.('Browserbase configured');
  log?.('Starting Browserbase session');
  const session = await createBrowserSession({
    projectId: getBrowserbaseProjectId(),
    timeoutMinutes: 2,
  });

  try {
    log?.('Rendering page');
    const snapshot = await openPage({
      sessionId: session.id,
      url,
      waitUntil: 'networkidle',
    });

    log?.('Extracting metadata');
    const text = [
      snapshot.title,
      snapshot.url,
      snapshot.screenshotUrl,
    ].filter(Boolean).join('\n\n');
    const result = extractDiscoveryFields(text, snapshot.title);

    if (!result.contract && !result.collectionName && !result.website && !Object.keys(result.socials ?? {}).length) {
      throw new Error('Browserbase returned empty metadata');
    }

    log?.('Browserbase succeeded');
    return {
      ...result,
      rawText: result.rawText ?? text,
    };
  } catch (error) {
    log?.(`Browserbase failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await closeBrowserSession(session.id).catch(() => undefined);
  }
}
