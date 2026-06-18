'use client';

import React from 'react';
import Card from '@/components/ui/Card';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

export default function StatCard({ title, value, icon, trend, trendValue }: StatCardProps) {
  const trendColors = {
    up: 'text-success',
    down: 'text-danger',
    neutral: 'text-muted',
  };

  return (
    <Card glow className="p-6 hover:border-blue-400/30 transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <div className="text-blue-500">{icon}</div>
        </div>
        {trend && trendValue && (
          <span className={`text-xs font-medium ${trendColors[trend]}`}>
            {trendValue}
          </span>
        )}
      </div>
      <h3 className="text-2xl font-bold text-white mb-1" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        {value}
      </h3>
      <p className="text-sm text-muted">{title}</p>
    </Card>
  );
}