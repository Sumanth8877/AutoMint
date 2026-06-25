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
          staleTime: 14400000, // 4 hours
          gcTime: 14400000, // 4 hours
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
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
            staleTime: 14400000, // 4 hours
            gcTime: 14400000, // 4 hours
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
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
