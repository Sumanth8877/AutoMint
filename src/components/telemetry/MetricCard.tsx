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

export default function MetricCard({ title, value, unit, trend, color = '#3B82F6', subtitle, loading }: MetricCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  return (
    <Card className="p-5">
      {loading ? (
        <div className="space-y-3">
          <div className="h-3 w-20 rounded bg-blue-500/10 animate-pulse" />
          <div className="h-8 w-24 rounded bg-blue-500/10 animate-pulse" />
          <div className="h-3 w-32 rounded bg-blue-500/10 animate-pulse" />
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-muted uppercase tracking-wider">{title}</p>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{value}</span>
            {unit && <span className="text-sm text-muted">{unit}</span>}
            {trend && <TrendIcon size={14} className={trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-muted'} />}
          </div>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </>
      )}
    </Card>
  );
}