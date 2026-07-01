import { ExternalLink, BarChart3, TrendingUp, Sparkles } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4">
      {/* Animated Gradient Background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-background via-background to-primary/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(120,119,198,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(120,119,198,0.08),transparent_50%)]" />
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="w-full max-w-5xl space-y-12">
        {/* Hero Section with Animations */}
        <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary/10 to-primary/5 px-4 py-1.5 text-sm font-medium border border-primary/20 backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
            <span>Advanced NFT Minting Platform</span>
          </div>

          {/* Title with Gradient */}
          <h1 className="text-5xl font-bold tracking-tight sm:text-7xl lg:text-8xl animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-150">
            <span className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
              AutoMint
            </span>
          </h1>

          {/* Description */}
          <p className="text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
            Analyze NFT mints, track performance, and monitor blockchain activity with real-time insights and advanced analytics.
          </p>
        </div>

        {/* Feature Cards with Advanced Hover Effects */}
        <div className="grid gap-6 md:grid-cols-2 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500">
          {/* Analyzer Card */}
          <Link
            href="/analyzer"
            className="group relative overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm p-8 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/10 hover:border-primary/50"
          >
            {/* Gradient Overlay on Hover */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative space-y-4">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-primary/10 p-3 ring-1 ring-primary/20 group-hover:ring-primary/40 group-hover:scale-110 transition-all duration-300">
                  <BarChart3 className="h-6 w-6 text-primary group-hover:animate-pulse" />
                </div>
                <h2 className="text-2xl font-semibold">Mint Analyzer</h2>
              </div>

              <p className="text-muted-foreground leading-relaxed">
                Analyze NFT mint contracts, estimate gas fees, and evaluate minting opportunities with AI-powered insights.
              </p>

              <div className="flex items-center gap-2 text-sm font-medium text-primary pt-2">
                <span>Go to Analyzer</span>
                <ExternalLink className="h-4 w-4 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
              </div>
            </div>

            {/* Decorative Elements */}
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 blur-3xl group-hover:bg-primary/10 transition-colors duration-500" />
          </Link>

          {/* Dashboard Card */}
          <Link
            href="/mints"
            className="group relative overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm p-8 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/10 hover:border-primary/50"
          >
            {/* Gradient Overlay on Hover */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative space-y-4">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-primary/10 p-3 ring-1 ring-primary/20 group-hover:ring-primary/40 group-hover:scale-110 transition-all duration-300">
                  <TrendingUp className="h-6 w-6 text-primary group-hover:animate-pulse" />
                </div>
                <h2 className="text-2xl font-semibold">Mint Dashboard</h2>
              </div>

              <p className="text-muted-foreground leading-relaxed">
                View your complete mint history, track transfers, and monitor real-time activity across all your mints.
              </p>

              <div className="flex items-center gap-2 text-sm font-medium text-primary pt-2">
                <span>Go to Dashboard</span>
                <ExternalLink className="h-4 w-4 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
              </div>
            </div>

            {/* Decorative Elements */}
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 blur-3xl group-hover:bg-primary/10 transition-colors duration-500" />
          </Link>
        </div>

        {/* Stats Section */}
        <div className="grid grid-cols-3 gap-6 pt-8 animate-in fade-in duration-1000 delay-700">
          <div className="text-center space-y-1">
            <div className="text-3xl font-bold bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
              10k+
            </div>
            <div className="text-sm text-muted-foreground">NFTs Minted</div>
          </div>
          <div className="text-center space-y-1">
            <div className="text-3xl font-bold bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
              50+
            </div>
            <div className="text-sm text-muted-foreground">Blockchains</div>
          </div>
          <div className="text-center space-y-1">
            <div className="text-3xl font-bold bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
              24/7
            </div>
            <div className="text-sm text-muted-foreground">Monitoring</div>
          </div>
        </div>

        {/* Footer Note */}
        <p className="text-center text-sm text-muted-foreground/70 animate-in fade-in duration-1000 delay-1000">
          Connect your wallet to get started with minting and tracking
        </p>
      </div>
    </main>
  );
}
