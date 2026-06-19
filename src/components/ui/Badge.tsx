'use client';

import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variants = {
    default: 'bg-white/5 text-white/60 border-[rgba(255,255,255,0.06)]',
    success: 'bg-[#18C964]/10 text-[#18C964] border-[#18C964]/20',
    warning: 'bg-[#F5A524]/10 text-[#F5A524] border-[#F5A524]/20',
    danger: 'bg-[#F31260]/10 text-[#F31260] border-[#F31260]/20',
    info: 'bg-[#4F8CFF]/10 text-[#4F8CFF] border-[#4F8CFF]/20',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}