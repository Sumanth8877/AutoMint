import { SignUp } from '@clerk/nextjs';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export default function SignUpPage() {
  return (
    <main className="automint-shell flex min-h-screen items-center justify-center px-4 py-10">
      <div className="surface-grid pointer-events-none absolute inset-0" />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        <Link href="/" className="flex items-center gap-3" aria-label="AutoMint home">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/15">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-text">AutoMint</span>
        </Link>
        <SignUp
          path="/sign-up"
          routing="path"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </main>
  );
}
