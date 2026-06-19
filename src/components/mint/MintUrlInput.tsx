'use client';
import React, { useState } from 'react';
import { ArrowRight, Zap, Sparkles, Loader2 } from 'lucide-react';

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
    <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/20 via-blue-600/10 to-blue-500/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
        <div className="relative flex items-center gap-3 p-2 rounded-2xl transition-all duration-300" style={{background: 'rgba(11,17,32,0.9)', border: '1px solid rgba(59,130,246,0.12)'}}>
          <div className="flex-shrink-0 pl-4"><Zap size={20} className="text-blue-500/60" /></div>
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste any NFT mint URL..." className="flex-1 bg-transparent text-white text-lg placeholder-slate-600 focus:outline-none py-3" autoFocus />
          {loading ? (
            <div className="flex-shrink-0 pr-3"><Loader2 size={20} className="animate-spin text-blue-500" /></div>
          ) : (
            <button type="submit" disabled={!url.trim()} className="flex-shrink-0 mr-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed" style={{background: url.trim() ? 'linear-gradient(135deg, #2563EB, #3B82F6)' : 'rgba(59,130,246,0.08)', color: '#FFFFFF', boxShadow: url.trim() ? '0 4px 15px rgba(59,130,246,0.3)' : 'none'}}>
              Analyze <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-center gap-6 mt-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><Sparkles size={12} /> Auto-detect collection</span>
        <span className="flex items-center gap-1.5"><Zap size={12} /> Mint instantly if live</span>
        <span className="flex items-center gap-1.5"><ArrowRight size={12} /> Schedule if upcoming</span>
      </div>
    </form>
  );
}