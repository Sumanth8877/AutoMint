import Image from 'next/image';
import { SignIn } from '@clerk/nextjs';
import { clerkAppearance } from '@/lib/clerk-appearance';
import { Sparkles } from 'lucide-react';

export default function SignInPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center p-4 overflow-hidden bg-background">
      {/* Subtle atmosphere */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_30%,rgba(79,70,229,0.06),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_70%,rgba(79,70,229,0.04),transparent_55%)]" />
      </div>

      <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        {/* Illustration side — hidden on small screens to keep the auth form focus */}
        <div className="hidden lg:block">
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border bg-white">
            <Image
              src="/illustrations/auth-sign-in.jpeg"
              alt="A small character holding a key up to a giant vault door keypad, standing on tiptoe."
              fill
              sizes="(min-width: 1024px) 32rem, 90vw"
              priority
              className="object-contain p-3"
            />
          </div>
          <p className="mt-4 text-center text-sm text-muted">Welcome back — your vault is expecting you.</p>
        </div>

        {/* Auth form side */}
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/15 bg-indigo-50 shadow-sm">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">AutoMint</h1>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted">NFT Minting Intelligence</p>
            </div>
          </div>

          <SignIn appearance={clerkAppearance} />
        </div>
      </div>
    </main>
  );
}
