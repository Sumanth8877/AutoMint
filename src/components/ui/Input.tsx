'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export default function Input({
  label,
  error,
  icon,
  className = '',
  ...props
}: InputProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-white/60 mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
            {icon}
          </div>
        )}
        <input
          className={`w-full bg-[#05070A] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-2.5 text-white placeholder:text-white/40 focus:outline-none focus:border-[#4F8CFF] focus:ring-1 focus:ring-[#4F8CFF] transition-all duration-200 ${
            icon ? 'pl-10' : ''
          } ${error ? 'border-[#F31260] focus:border-[#F31260] focus:ring-[#F31260]' : ''} ${className}`}
          {...props}
        />
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-[#F31260]">{error}</p>
      )}
    </div>
  );
}