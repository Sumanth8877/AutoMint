'use client';
import React, { useState } from 'react';
import { ArrowRight, Zap, CheckCircle2 } from 'lucide-react';

interface MintUrlInputProps {
  onAnalyze: (url: string) => void;
  loading?: boolean;
}

export default function MintUrlInput({ onAnalyze, loading }: MintUrlInputProps) {
  const [url, setUrl] = useState('');
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) onAnalyze(url.trim());
  };
  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[900px] mx-auto">
      <div className="relative w-full">
        <div className="absolute -inset-px rounded-2xl opacity-0 group-[.focus-within]:opacity-100 transition-opacity duration-500" style={{background:'linear-gradient(90deg, rgba(59,130,246,0.35), rgba(59,130,246,0.05))'}} />
        <div className="relative flex items-center gap-3 p-1.5 rounded-2xl transition-all duration-300" style={{background:'#0A1025', border:'1px solid rgba(59,130,246,0.2)'}}>
          <div className="flex-shrink-0 pl-4">
            <Zap size={20} className="text-blue-500" />
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste OpenSea, Mint.fun, Zora, Manifold or mint URL..."
            className="flex-1 bg-transparent text-white text-base md:text-lg placeholder-slate-600 focus:outline-none h-[72px]"
            autoFocus
          />
          {loading ? (
            <div className="flex-shrink-0 pr-4">
              <div className="w-5 h-5 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
            </div>
          ) : (
            <button
              type="submit"
              disabled={!url.trim()}
              className="flex-shrink-0 mr-2 h-[56px] px-6 md:px-8 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: url.trim() ? 'linear-gradient(135deg, #2563EB, #3B82F6)' : 'rgba(59,130,246,0.08)',
                color: '#FFFFFF',
                boxShadow: url.trim() ? '0 4px 20px rgba(59,130,246,0.35)' : 'none',
              }}
            >
              Analyze <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-5 sm:gap-8 mt-5 text-xs text-slate-500">
        <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> Detect Collection</span>
        <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> Discover Mint Function</span>
        <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> Verify Requirements</span>
        <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> Mint If Live</span>
        <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500" /> Schedule If Upcoming</span>
      </div>
    </form>
  );
}