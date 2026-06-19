'use client';

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-6 ${
        onClick ? 'cursor-pointer hover:border-[rgba(255,255,255,0.12)] transition-all duration-200' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}