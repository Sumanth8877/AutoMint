'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiRequest } from '@/lib/api/client';
import OnboardingWizard from './onboarding-wizard';

type OnboardingStatus = {
  completed: boolean;
  completedAt: string | null;
};

export default function OnboardingGate({ children }: { children: ReactNode }) {
  const [dismissed, setDismissed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => apiRequest<OnboardingStatus>('/api/onboarding/complete'),
    staleTime: Infinity,
    retry: false,
  });

  // Don't block rendering while checking
  if (isLoading || dismissed || data?.completed) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <OnboardingWizard onComplete={() => setDismissed(true)} />
    </>
  );
}
