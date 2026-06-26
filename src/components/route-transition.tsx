'use client';

import type { ReactNode } from 'react';

export function RouteTransition({ children }: { children: ReactNode }) {
  return (
    <div style={{ animation: 'am-fade-in-up-sm 0.28s ease-out both' }}>
      {children}
    </div>
  );
}
