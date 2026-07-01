import { ExternalLink, BarChart3, TrendingUp } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-4xl space-y-8">
        {/* Hero Section */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            AutoMint
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Analyze NFT mints, track performance, and monitor blockchain activity — all in one place.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Analyzer Card */}
          <Link
            href="/analyzer"
            className="group relative overflow-hidden rounded-lg border bg-card p-6 transition-all hover:shadow-lg"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">Mint Analyzer</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Analyze NFT mint contracts, estimate gas fees, and evaluate minting opportunities.
              </p>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                Go to Analyzer
                <ExternalLink className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>

          {/* Dashboard Card */}
          <Link
            href="/mints"
            className="group relative overflow-hidden rounded-lg border bg-card p-6 transition-all hover:shadow-lg"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">Mint Dashboard</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                View your mint history, track transfers, and monitor activity across all your mints.
              </p>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                Go to Dashboard
                <ExternalLink className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        </div>

        {/* Footer Note */}
        <p className="text-center text-sm text-muted-foreground">
          Connect your wallet to get started with minting and tracking
        </p>
      </div>
    </main>
  );
}
