import React from 'react';

interface PanelProps {
  children: React.ReactNode;
  className?: string;
}

export default function Panel({ children, className = '' }: PanelProps) {
  return (
    <div className={`bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg ${className}`}>
      {children}
    </div>
  );
}
