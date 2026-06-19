'use client';
import React from 'react';
import Card from '@/components/ui/Card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
  subtitle?: string;
  loading?: boolean;
}

export default function MetricCard({ title, value, unit, trend, color = '#4F8CFF', subtitle, loading }: MetricCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  return (
    <Card className="p-5">
      {loading ? (
        <div className="space-y-3">
          <div className="h-3 w-20 rounded bg-[#4F8CFF]/10 animate-pulse" />
          <div className="h-8 w-24 rounded bg-[#4F8CFF]/10 animate-pulse" />
          <div className="h-3 w-32 rounded bg-[#4F8CFF]/10 animate-pulse" />
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-white/40 uppercase tracking-wider">{title}</p>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-semibold text-white">{value}</span>
            {unit && <span className="text-sm text-white/40">{unit}</span>}
            {trend && <TrendIcon size={14} className={trend === 'up' ? 'text-[#18C964]' : trend === 'down' ? 'text-[#F31260]' : 'text-white/40'} />}
          </div>
          {subtitle && <p className="text-xs text-white/40 mt-1">{subtitle}</p>}
        </>
      )}
    </Card>
  );
}