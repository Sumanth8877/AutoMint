'use client';

import type { ReactNode } from 'react';
import { PageTransition } from '@/components/motion';

/**
 * Wraps route content. Next re-mounts the (authenticated) `template.tsx` on every
 * navigation, so a plain mount animation (no AnimatePresence needed) runs on each
 * route change. PageTransition honours prefers-reduced-motion.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
