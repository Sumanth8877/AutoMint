type ClarityEvent = {
  name: string;
  properties?: Record<string, any>;
};

declare global {
  interface Window {
    clarity?: (cmd: 'event' | 'identify' | 'set', ...args: any[]) => void;
  }
}

const SENSITIVE_KEYS = ['password', 'secret', 'privateKey', 'seed', 'mnemonic', 'walletSecret'];

function sanitize(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const out: any = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object') {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function trackEvent(event: ClarityEvent) {
  if (!window.clarity) return;
  try {
    const payload = sanitize({
      ...event,
      properties: sanitize(event.properties),
    });
    window.clarity('event', payload.name, payload.properties);
  } catch {
    // swallow analytics errors
  }
}

export function trackPageView(path: string) {
  if (!window.clarity) return;
  trackEvent({ name: 'pageview', properties: { path } });
}

export function identifyUser(userId: string, traits: Record<string, any> = {}) {
  if (!window.clarity) return;
  trackEvent({ name: 'user_identified', properties: { userId, ...traits } });
}