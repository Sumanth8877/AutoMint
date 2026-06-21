import type { Instrumentation } from 'next';
import { captureException, initSentry } from '@/lib/observability/sentry';

export function register() {
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
