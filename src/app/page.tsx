'use client';
import React, { useState, useEffect } from 'react';
import { Search, Bell, Settings, User, Sparkles, Zap, Shield, Target, ArrowRight, Copy, CheckCircle2, AlertCircle, Clock, TrendingUp, Flame, Activity, History, Keyboard, Clipboard } from 'lucide-react';
import { motion } from 'framer-motion';

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleAnalyze = async () => {
    if (!url) return;
    setAnalyzing(true);
    setAnalysis(null);
    setError(null);
    try {
      await new Promise(r => setTimeout(r, 2500));
      setAnalysis({
        status: 'live',
        collection: 'Bored Ape Yacht Club',
        launchpad: 'Magic Eden',
        mintPrice: '0.05',
        supply: '9,950 / 10,000',
        mintDate: '2024-03-15',
        whitelist: true,
        contractRisk: 'Low',
        liquidityRisk: 'Medium',
        botCompetition: 'High',
        recommendedWallets: 3,
        priorityFee: '0.002',
        expectedDemand: 'Very High',
        suggestedActions: ['Prepare 3 wallets', 'Set priority fee to 0.002 ETH', 'Monitor launchpad 30min before']
      });
    } catch (err) {
      setError('Failed to analyze collection. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch (err) {
      setError('Failed to paste from clipboard');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        handleAnalyze();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [url]);

  return (
    <div className="min-h-screen bg-[#050816]">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 glass border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="text-white font-semibold text-lg">AutoMint</span>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <a href="#" className="text-white/70 hover:text-white text-sm transition-colors">Dashboard</a>
              <a href="#" className="text-white font-medium text-sm">Mint Analyzer</a>
              <a href="#" className="text-white/70 hover:text-white text-sm transition-colors">Strategies</a>
              <a href="#" className="text-white/70 hover:text-white text-sm transition-colors">History</a>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <Search className="w-4 h-4 text-white/40" />
              <input
                type="text"
                placeholder="Search..."
                className="bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none w-32"
              />
            </div>
            <button className="p-2 text-white/60 hover:text-white transition-colors" aria-label="Notifications">
              <Bell className="w-5 h-5" />
            </button>
            <button className="p-2 text-white/60 hover:text-white transition-colors" aria-label="Settings">
              <Settings className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4F46E5] to-[#06B6D4] flex items-center justify-center cursor-pointer" aria-label="Profile">
              <User className="w-4 h-4 text-white" />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-12">
        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="px-3 py-1 rounded-full bg-[#4F46E5]/10 border border-[#4F46E5]/20 text-[#4F46E5] text-xs font-medium">
              Real-time Analysis
            </span>
            <span className="px-3 py-1 rounded-full bg-[#06B6D4]/10 border border-[#06B6D4]/20 text-[#06B6D4] text-xs font-medium">
              Solana Launchpads
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold text-white mb-3 tracking-tight">
            NFT Mint Intelligence
          </h1>
          <p className="text-white/60 text-base max-w-2xl mx-auto">
            Analyze launchpad collections, detect contracts, estimate mint risks, and prepare automated mint strategies.
          </p>
        </motion.div>

        {/* Analysis Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="max-w-[1000px] mx-auto mb-10"
        >
          <div className="gradient-border p-[1px]">
            <div className="glass-card rounded-[20px] p-8">
              <div className="mb-6">
                <label htmlFor="url-input" className="block text-sm font-medium text-white/80 mb-2">NFT Mint URL</label>
                <div className="relative">
                  <input
                    id="url-input"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                    placeholder="https://magiceden.io/launchpad/collection"
                    className="w-full h-[56px] bg-[#050816] border border-white/10 rounded-xl px-4 pr-24 text-white placeholder:text-white/40 focus:outline-none focus:border-[#4F46E5] focus:ring-2 focus:ring-[#4F46E5]/20 transition-all"
                    aria-describedby="url-hint"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      onClick={handlePaste}
                      className="p-2 text-white/40 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                      aria-label="Paste from clipboard"
                    >
                      <Clipboard className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCopy}
                      className="p-2 text-white/40 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                      aria-label="Copy to clipboard"
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4 text-[#10B981]" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <p id="url-hint" className="text-xs text-white/40 mt-2 flex items-center gap-1">
                  <Keyboard className="w-3 h-3" />
                  Example: magiceden.io/launchpad/collection-name · Press Ctrl+Enter to analyze
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handlePaste}
                  className="flex-1 h-[56px] px-6 bg-white/5 border border-white/10 rounded-xl text-white font-medium hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                >
                  <Clipboard className="w-4 h-4" />
                  Paste
                </button>
                <button
                  onClick={handleAnalyze}
                  disabled={!url || analyzing}
                  className="flex-1 h-[56px] px-6 bg-gradient-to-r from-[#4F46E5] to-[#06B6D4] text-white rounded-xl font-medium hover:scale-[1.02] hover:shadow-lg hover:shadow-[#4F46E5]/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none transition-all flex items-center justify-center gap-2"
                  aria-label="Analyze collection"
                >
                  {analyzing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      Analyze Collection
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Error State */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[1000px] mx-auto mb-8"
          >
            <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-[#EF4444]" />
              <span className="text-white/80 text-sm">{error}</span>
            </div>
          </motion.div>
        )}

        {/* Quick Stats */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12"
        >
          {[
            { label: 'Collections', value: '245', icon: Sparkles, color: '#4F46E5' },
            { label: 'Success %', value: '83%', icon: TrendingUp, color: '#10B981' },
            { label: 'Avg ROI', value: '2.4x', icon: Zap, color: '#06B6D4' },
            { label: 'Monitored', value: '1.2k', icon: Target, color: '#F59E0B' },
          ].map((stat, i) => (
            <motion.div
              key={i}
              whileHover={{ scale: 1.02, y: -2 }}
              transition={{ duration: 0.2 }}
              className="glass-card rounded-xl p-6 h-[120px] flex flex-col justify-center"
            >
              <div className="flex items-center gap-2 mb-3">
                <stat.icon className="w-5 h-5" style={{ color: stat.color }} />
                <p className="text-white/60 text-xs uppercase tracking-wide">{stat.label}</p>
              </div>
              <p className="text-3xl font-semibold text-white">{stat.value}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Analysis Results */}
        {analysis && !analyzing && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6 mb-12"
          >
            {/* Collection Overview */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-6">
                <Sparkles className="w-5 h-5 text-[#4F46E5]" />
                <h3 className="text-lg font-semibold text-white">Collection Overview</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-white/60 text-sm mb-1">Project Name</p>
                  <p className="text-white font-medium">{analysis.collection}</p>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-1">Launchpad</p>
                  <p className="text-white font-medium">{analysis.launchpad}</p>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-1">Mint Price</p>
                  <p className="text-white font-medium">{analysis.mintPrice} ETH</p>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-1">Supply</p>
                  <p className="text-white font-medium">{analysis.supply}</p>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-1">Mint Date</p>
                  <p className="text-white font-medium">{analysis.mintDate}</p>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-1">Whitelist</p>
                  <p className="text-white font-medium">{analysis.whitelist ? 'Yes' : 'No'}</p>
                </div>
              </div>
            </div>

            {/* Risk Analysis */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-6">
                <Shield className="w-5 h-5 text-[#F59E0B]" />
                <h3 className="text-lg font-semibold text-white">Risk Analysis</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: 'Contract Risk', value: analysis.contractRisk, color: analysis.contractRisk === 'Low' ? '#10B981' : analysis.contractRisk === 'Medium' ? '#F59E0B' : '#EF4444' },
                  { label: 'Liquidity Risk', value: analysis.liquidityRisk, color: analysis.liquidityRisk === 'Low' ? '#10B981' : analysis.liquidityRisk === 'Medium' ? '#F59E0B' : '#EF4444' },
                  { label: 'Bot Competition', value: analysis.botCompetition, color: analysis.botCompetition === 'Low' ? '#10B981' : analysis.botCompetition === 'Medium' ? '#F59E0B' : '#EF4444' },
                ].map((risk, i) => (
                  <div key={i} className="bg-[#050816] rounded-xl p-4 border border-white/10">
                    <p className="text-white/60 text-sm mb-2">{risk.label}</p>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: risk.color }} />
                      <p className="text-white font-medium" style={{ color: risk.color }}>{risk.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mint Strategy */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-6">
                <Target className="w-5 h-5 text-[#06B6D4]" />
                <h3 className="text-lg font-semibold text-white">Mint Strategy</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <p className="text-white/60 text-sm mb-1">Recommended Wallets</p>
                  <p className="text-white font-medium">{analysis.recommendedWallets}</p>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-1">Priority Fee</p>
                  <p className="text-white font-medium">{analysis.priorityFee} ETH</p>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-1">Expected Demand</p>
                  <p className="text-white font-medium">{analysis.expectedDemand}</p>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-1">Status</p>
                  <p className="text-[#10B981] font-medium">Ready</p>
                </div>
              </div>
              <div className="bg-[#050816] rounded-xl p-4 border border-white/10">
                <p className="text-white/60 text-sm mb-3">Suggested Actions</p>
                <ul className="space-y-2">
                  {analysis.suggestedActions.map((action: string, i: number) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-white/80">
                      <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        )}

        {/* Empty State */}
        {!analysis && !analyzing && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="max-w-2xl mx-auto text-center mb-12"
          >
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[#4F46E5]/10 to-[#06B6D4]/10 border border-white/10 flex items-center justify-center mx-auto mb-6">
              <Search className="w-12 h-12 text-white/40" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-3">Paste a launchpad URL to begin analysis</h3>
            <p className="text-white/60 mb-8">Get instant insights on contract security, mint risks, and optimal strategies.</p>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Shield, text: 'Contract Detection' },
                { icon: TrendingUp, text: 'Risk Scoring' },
                { icon: Clock, text: 'Mint Forecast' },
                { icon: Zap, text: 'AutoMint Preparation' },
              ].map((feature, i) => (
                <motion.div
                  key={i}
                  whileHover={{ scale: 1.02, y: -2 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10"
                >
                  <feature.icon className="w-5 h-5 text-[#4F46E5]" />
                  <span className="text-sm text-white/80">{feature.text}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Content Below Fold */}
        {!analysis && !analyzing && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-6"
          >
            {/* Recent Analyses */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#4F46E5]" />
                  <h3 className="text-lg font-semibold text-white">Recent Analyses</h3>
                </div>
                <button className="text-sm text-[#4F46E5] hover:text-[#4338CA] transition-colors">View All</button>
              </div>
              <div className="space-y-3">
                {[
                  { name: 'Bored Ape Yacht Club', status: 'Completed', time: '2h ago' },
                  { name: 'Doodles', status: 'Completed', time: '5h ago' },
                  { name: 'Azuki', status: 'Analyzing', time: 'Just now' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                    <div>
                      <p className="text-sm font-medium text-white">{item.name}</p>
                      <p className="text-xs text-white/40">{item.time}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${item.status === 'Completed' ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Trending Launchpads */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Flame className="w-5 h-5 text-[#F59E0B]" />
                  <h3 className="text-lg font-semibold text-white">Trending Launchpads</h3>
                </div>
                <button className="text-sm text-[#4F46E5] hover:text-[#4338CA] transition-colors">View All</button>
              </div>
              <div className="space-y-3">
                {[
                  { name: 'Magic Eden', demand: 'Very High', risk: 'Low' },
                  { name: 'Tensor', demand: 'High', risk: 'Medium' },
                  { name: 'OpenSea', demand: 'Medium', risk: 'Low' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                    <div>
                      <p className="text-sm font-medium text-white">{item.name}</p>
                      <p className="text-xs text-white/40">Demand: {item.demand}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${item.risk === 'Low' ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>
                      {item.risk}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk Feed */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-[#EF4444]" />
                  <h3 className="text-lg font-semibold text-white">Risk Feed</h3>
                </div>
                <button className="text-sm text-[#4F46E5] hover:text-[#4338CA] transition-colors">View All</button>
              </div>
              <div className="space-y-3">
                {[
                  { collection: 'Unknown Project #42', risk: 'High', reason: 'Unverified contract' },
                  { collection: 'Quick Mint', risk: 'Medium', reason: 'Low liquidity' },
                  { collection: 'Hype Collection', risk: 'Low', reason: 'Verified team' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                    <div>
                      <p className="text-sm font-medium text-white">{item.collection}</p>
                      <p className="text-xs text-white/40">{item.reason}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${item.risk === 'High' ? 'bg-[#EF4444]/10 text-[#EF4444]' : item.risk === 'Medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#10B981]/10 text-[#10B981]'}`}>
                      {item.risk}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Analysis History */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-[#06B6D4]" />
                  <h3 className="text-lg font-semibold text-white">Analysis History</h3>
                </div>
                <button className="text-sm text-[#4F46E5] hover:text-[#4338CA] transition-colors">View All</button>
              </div>
              <div className="space-y-3">
                {[
                  { date: '2024-03-15', count: 12, success: 10 },
                  { date: '2024-03-14', count: 8, success: 7 },
                  { date: '2024-03-13', count: 15, success: 12 },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                    <div>
                      <p className="text-sm font-medium text-white">{item.date}</p>
                      <p className="text-xs text-white/40">{item.count} analyses</p>
                    </div>
                    <span className="text-xs text-[#10B981]">{item.success} successful</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}