'use client';

import { UserButton } from '@clerk/nextjs';
import { clerkUserButtonAppearance } from '@/lib/clerk-appearance';

export default function AutoMintUserButton() {
  return (
    <UserButton
      appearance={clerkUserButtonAppearance}
      userProfileProps={{
        appearance: clerkUserButtonAppearance,
      }}
    />
  );
}
