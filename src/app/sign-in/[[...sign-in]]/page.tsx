import { SignIn } from '@clerk/nextjs';
import { clerkAppearance } from '@/lib/clerk-appearance';
import { Sparkles } from 'lucide-react';

export default function SignInPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center p-4 overflow-hidden">
      {/* Atmosphere */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_30%,rgba(0,255,136,0.15),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_70%,rgba(0,255,136,0.08),transparent_55%)]" />
      </div>

      <div className="mb-10 flex flex-col items-center gap-4">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl border border-neon/25 bg-gradient-to-br from-primary/30 to-neon/15"
          style={{ boxShadow: '0 0 40px rgba(0,255,136,0.20)' }}
        >
          <Sparkles className="h-7 w-7 text-neon" />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-black tracking-tight gradient-text-neon">AutoMint</h1>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.20em] text-muted">NFT Minting Intelligence</p>
        </div>
      </div>

      <SignIn appearance={clerkAppearance} />
    </main>
  );
}
