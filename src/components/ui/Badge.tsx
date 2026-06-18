'use client';

import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variants = {
    default: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    success: 'bg-green-500/10 text-success border-green-500/20',
    warning: 'bg-yellow-500/10 text-warning border-yellow-500/20',
    danger: 'bg-red-500/10 text-danger border-red-500/20',
    info: 'bg-blue-500/10 text-primary border-blue-500/20',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}