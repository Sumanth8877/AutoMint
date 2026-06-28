import type { InputHTMLAttributes, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
}

export default function Input({
  label,
  error,
  hint,
  icon,
  className = '',
  ...props
}: InputProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            {icon}
          </div>
        )}
        <input
          className={`h-11 w-full rounded-lg border bg-background/60 px-3.5 text-sm text-text placeholder:text-muted/60 transition-all duration-150 focus:outline-none focus:ring-2 ${
            icon ? 'pl-10' : ''
          } ${
            error
              ? 'border-danger focus:border-danger focus:ring-danger/20'
              : 'border-border focus:border-primary focus:ring-primary/20'
          } ${className}`}
          {...props}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-sm text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
