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
    up: 'text-[#18C964]',
    down: 'text-[#F31260]',
    neutral: 'text-white/60',
  };

  return (
    <Card className="p-6 hover:border-[rgba(255,255,255,0.12)] transition-all duration-200">
      <div className="flex items-start justify-between mb-4">
        <div className="p-2.5 rounded-lg bg-[#4F8CFF]/10 border border-[#4F8CFF]/20">
          <div className="text-[#4F8CFF]">{icon}</div>
        </div>
        {trend && trendValue && (
          <span className={`text-xs font-medium ${trendColors[trend]}`}>
            {trendValue}
          </span>
        )}
      </div>
      <h3 className="text-2xl font-semibold text-white mb-1">
        {value}
      </h3>
      <p className="text-sm text-white/60">{title}</p>
    </Card>
  );
}