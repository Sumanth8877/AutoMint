'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import Card from '@/components/ui/Card';

export default function HistoryPage() {
  return (
    <div>
      <div className="mb-8">
        <h1
          className="text-2xl sm:text-3xl font-bold text-white"
          style={{ fontFamily: 'Space Grotesk, sans-serif' }}
        >
          Mint History
        </h1>
        <p className="text-muted mt-1">View your past minting activity</p>
      </div>

      <Card className="p-12">
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
            <Clock size={28} className="text-muted" />
          </div>
          <h3
            className="text-lg font-semibold text-white mb-2"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            No mint history yet
          </h3>
          <p className="text-muted text-sm text-center max-w-sm">
            Your completed mint transactions will appear here with detailed logs and status updates.
          </p>
        </div>
      </Card>
    </div>
  );
}