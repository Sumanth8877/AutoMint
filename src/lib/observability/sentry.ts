type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

type SentryContext = {
  userId?: string;
  walletId?: string;
  wallet?: string;
  collection?: string;
  chain?: string;
  taskId?: string;
  transactionHash?: string;
  telegramId?: string;
  chatId?: string;
  provider?: string;
  messageId?: string;
  scheduleId?: string;
  url?: string;
  [key: string]: unknown;
};

type Breadcrumb = {
  category: string;
  message: string;
  level?: SentryLevel;
  data?: Record<string, unknown>;
  timestamp: number;
};

type CaptureOptions = {
  level?: SentryLevel;
  area?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  context?: SentryContext;
  fingerprint?: string[];
};

const MAX_BREADCRUMBS = 50;
const breadcrumbs: Breadcrumb[] = [];
let initialized = false;

function getDsn() {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
}

function getEnvironment() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
}

function getRelease() {
  return process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local';
}

function parseDsn(dsn: string) {
  const url = new URL(dsn);
  const publicKey = url.username;
  const projectId = url.pathname.replace(/^\//, '').split('/').pop();
  if (!publicKey || !projectId) throw new Error('Invalid Sentry DSN');
  return {
    endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`,
    publicKey,
  };
}

function shouldCapture(message: string) {
  const normalized = message.toLowerCase();
  const ignored = [
    'invalid json request body',
    'is required',
    'not found',
    'already added',
    'cancelled',
    'canceled',
    'risk approval required',
    'mint not live',
    'telegram_not_linked',
    'balance_above_threshold',
  ];
  return !ignored.some((phrase) => normalized.includes(phrase));
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      type: error.name || 'Error',
      value: error.message,
      stacktrace: error.stack
        ? {
            frames: error.stack.split('\n').slice(1).map((line) => ({
              filename: line.trim(),
              function: '<anonymous>',
              in_app: true,
            })).reverse(),
          }
        : undefined,
    };
  }

  return {
    type: 'Error',
    value: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

function baseEvent(options: CaptureOptions = {}) {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    platform: 'javascript',
    timestamp: Date.now() / 1000,
    environment: getEnvironment(),
    release: getRelease(),
    level: options.level ?? 'error',
    tags: {
      area: options.area ?? 'application',
      deployment_version: getRelease(),
      ...(options.tags ?? {}),
    },
    user: options.context?.userId ? { id: options.context.userId } : undefined,
    contexts: {
      automint: {
        environment: getEnvironment(),
        deploymentVersion: getRelease(),
        walletId: options.context?.walletId,
        wallet: options.context?.wallet,
        collection: options.context?.collection,
        chain: options.context?.chain,
        taskId: options.context?.taskId,
        transactionHash: options.context?.transactionHash,
        telegramId: options.context?.telegramId,
        chatId: options.context?.chatId,
        provider: options.context?.provider,
        messageId: options.context?.messageId,
        scheduleId: options.context?.scheduleId,
        url: options.context?.url,
      },
    },
    extra: {
      ...(options.extra ?? {}),
      ...(options.context ?? {}),
    },
    breadcrumbs,
    fingerprint: options.fingerprint,
  };
}

async function sendEvent(event: Record<string, unknown>) {
  const dsn = getDsn();
  if (!dsn || process.env.SENTRY_DISABLED === 'true') return;

  try {
    const parsed = parseDsn(dsn);
    const envelope = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');

    await fetch(parsed.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: envelope,
      keepalive: typeof window !== 'undefined',
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error('Sentry capture failed:', error);
  }
}

export function initSentry() {
  initialized = true;
  addBreadcrumb({
    category: 'sentry',
    message: 'sentry initialized',
    level: 'info',
    data: { environment: getEnvironment(), release: getRelease() },
  });
}

export function addBreadcrumb(input: Omit<Breadcrumb, 'timestamp'>) {
  breadcrumbs.push({ ...input, timestamp: Date.now() / 1000 });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
}

export async function captureException(error: unknown, options: CaptureOptions = {}) {
  const exception = serializeError(error);
  if (!shouldCapture(exception.value)) return;
  if (!initialized) initSentry();

  await sendEvent({
    ...baseEvent(options),
    exception: { values: [exception] },
  });
}

export async function captureMessage(message: string, options: CaptureOptions = {}) {
  if (!shouldCapture(message)) return;
  if (!initialized) initSentry();

  await sendEvent({
    ...baseEvent(options),
    message,
    level: options.level ?? 'info',
  });
}

export async function capturePerformance(name: string, durationMs: number, options: CaptureOptions = {}) {
  if (!initialized) initSentry();

  await sendEvent({
    ...baseEvent({ ...options, level: 'info' }),
    message: `performance:${name}`,
    type: 'transaction',
    transaction: name,
    start_timestamp: (Date.now() - durationMs) / 1000,
    timestamp: Date.now() / 1000,
    measurements: {
      duration_ms: { value: durationMs, unit: 'millisecond' },
    },
  });
}

export async function startSpan<T>(
  name: string,
  context: SentryContext,
  fn: () => Promise<T>,
) {
  const startedAt = Date.now();
  addBreadcrumb({ category: 'span', message: `${name} started`, level: 'info', data: context });
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    addBreadcrumb({ category: 'span', message: `${name} completed`, level: 'info', data: { ...context, durationMs } });
    await capturePerformance(name, durationMs, { area: 'performance', context });
    return result;
  } catch (error) {
    await captureException(error, {
      area: context.area as string | undefined,
      context: { ...context, durationMs: Date.now() - startedAt },
    });
    throw error;
  }
}
