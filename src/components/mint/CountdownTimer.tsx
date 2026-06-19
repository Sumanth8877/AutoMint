'use client';
import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface CountdownTimerProps {
  targetTime: Date | string;
  onExpire?: () => void;
}

export default function CountdownTimer({ targetTime, onExpire }: CountdownTimerProps) {
  const target = new Date(targetTime).getTime();
  const calculate = () => {
    const diff = target - Date.now();
    if (diff <= 0) return { h: 0, m: 0, s: 0, expired: true };
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    return { h, m, s, expired: false };
  };
  const [time, setTime] = useState(calculate);

  useEffect(() => {
    if (time.expired) { onExpire?.(); return; }
    const id = setInterval(() => setTime(calculate()), 1000);
    return () => clearInterval(id);
  }, [time.expired, onExpire]);

  if (time.expired) {
    return <span className="text-sm font-medium text-green-500">Live now</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <Clock size={14} className="text-blue-500" />
      <span className="text-sm font-medium text-white">
        {String(time.h).padStart(2, '0')}h {String(time.m).padStart(2, '0')}m {String(time.s).padStart(2, '0')}s
      </span>
    </div>
  );
}