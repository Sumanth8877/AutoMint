import type { Instrumentation } from 'next';
import { captureException, initSentry } from '@/lib/observability/sentry';

export function register() {
  // M-2 fix: validate required env vars at startup so missing vars surface
  // as a clear boot error rather than an obscure mid-request crash.
  const { validateEnv } = require('@/lib/config/validate');
  validateEnv();
  initSentry();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await captureException(error, {
    area: 'next',
    context: {
      url: request.path,
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
      renderSource: context.renderSource,
      environment: process.env.NODE_ENV,
      deploymentVersion: process.env.VERCEL_GIT_COMMIT_SHA,
    },
    tags: {
      route_type: context.routeType,
      router_kind: context.routerKind,
    },
  });
};
