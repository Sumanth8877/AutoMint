import { addBreadcrumb, captureException, initSentry } from '@/lib/observability/sentry';

try {
  initSentry();

  window.addEventListener('error', (event) => {
    void captureException(event.error || event.message, {
      area: 'frontend',
      context: {
        url: window.location.href,
        environment: process.env.NODE_ENV,
        deploymentVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    void captureException(event.reason, {
      area: 'frontend',
      context: {
        url: window.location.href,
        environment: process.env.NODE_ENV,
        deploymentVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
      },
    });
  });
} catch {
}

export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse') {
  addBreadcrumb({
    category: 'navigation',
    message: 'router transition started',
    level: 'info',
    data: { url, navigationType },
  });
}
