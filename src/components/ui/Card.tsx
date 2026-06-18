'use client';

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  onClick?: () => void;
}

export default function Card({ children, className = '', glow = false, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`card p-6 ${glow ? 'glow' : ''} ${
        onClick ? 'cursor-pointer hover:border-blue-400/30 transition-all duration-300' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}