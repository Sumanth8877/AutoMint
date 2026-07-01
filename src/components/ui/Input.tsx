import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** Alias for leftIcon — accepted for backward compat */
  icon?: React.ReactNode;
}

export default function Input({ label, error, hint, leftIcon, icon, rightIcon, className = '', id, ...props }: InputProps) {
  const resolvedLeftIcon = leftIcon ?? icon;
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-widest text-secondary">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {resolvedLeftIcon && (
          <span className="absolute left-3 flex items-center text-muted pointer-events-none">{resolvedLeftIcon}</span>
        )}
        <input
          id={inputId}
          className={`h-10 w-full rounded-lg border bg-background/80 text-text placeholder:text-muted/50             transition-all duration-150 text-sm             focus:outline-none focus:border-neon/60 focus:ring-2 focus:ring-neon/15 focus:bg-background             disabled:cursor-not-allowed disabled:opacity-50             ${error ? 'border-danger/60 ring-2 ring-danger/15' : 'border-border hover:border-border-strong'}             ${leftIcon ? 'pl-9' : 'pl-3'}             ${rightIcon ? 'pr-9' : 'pr-3'}             ${className}`}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3 flex items-center text-muted pointer-events-none">{rightIcon}</span>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
