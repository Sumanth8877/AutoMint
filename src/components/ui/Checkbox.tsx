'use client';

import { Check } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * Shared modern checkbox primitive — solid indigo fill with a white
 * checkmark when checked (Linear/Stripe/Notion style) instead of a
 * native browser checkbox or a faint tinted-background variant. The
 * checkmark pops in with a quick scale + fade transition.
 */
export default function Checkbox({
  checked,
  onChange,
  disabled = false,
  className = '',
  ...rest
}: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'border-primary bg-primary shadow-sm shadow-primary/25'
          : 'border-border-strong bg-surface hover:border-primary/50 hover:bg-indigo-50'
      } ${className}`}
      {...rest}
    >
      <Check
        className={`h-3.5 w-3.5 text-white transition-all duration-200 ${
          checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
        }`}
        strokeWidth={3}
        aria-hidden="true"
      />
    </button>
  );
}
