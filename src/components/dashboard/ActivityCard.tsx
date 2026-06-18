'use client';

import React from 'react';
import Card from '@/components/ui/Card';
import { Clock } from 'lucide-react';

export default function ActivityCard() {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Clock size={18} className="text-blue-500" />
        <h2
          className="text-lg font-semibold text-white"
          style={{ fontFamily: 'Space Grotesk, sans-serif' }}
        >
          Recent Activity
        </h2>
      </div>
      <div className="flex flex-col items-center justify-center py-10">
        <div className="w-14 h-14 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
          <Clock size={24} className="text-muted" />
        </div>
        <p className="text-muted text-sm">No activity yet</p>
        <p className="text-muted/50 text-xs mt-1">
          Your mint activity will appear here
        </p>
      </div>
    </Card>
  );
}