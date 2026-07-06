'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always create a new client
    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,     // 1 minute — SSE handles real-time invalidation
          gcTime: 600_000,       // 10 minutes — keep garbage-collected data longer
          refetchOnWindowFocus: true,   // refetch when user tabs back
          refetchOnReconnect: true,     // refetch after network reconnect
          retry: 1,
          retryDelay: 1000,
        },
      },
    });
  } else {
    // Browser: create client once and reuse
    if (!browserQueryClient) {
      browserQueryClient = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,     // 1 minute — SSE handles real-time invalidation
            gcTime: 600_000,       // 10 minutes
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: 1,
            retryDelay: 1000,
          },
        },
      });
    }
    return browserQueryClient;
  }
}

export function QueryClientProviderWrapper({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
