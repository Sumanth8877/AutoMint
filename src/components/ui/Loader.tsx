interface LoaderProps {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neon' | 'purple' | 'white';
  label?: string;
}

const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
const tones = {
  neon:   'border-neon/30 border-t-neon',
  purple: 'border-primary/30 border-t-primary',
  white:  'border-white/20 border-t-white',
};

export default function Loader({ size = 'md', tone = 'neon', label }: LoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3" role="status" aria-label={label ?? 'Loading'}>
      <div
        className={`${sizes[size]} rounded-full border-2 ${tones[tone]} animate-spin`}
        style={{ boxShadow: tone === 'neon' ? '0 0 12px rgba(0,245,255,0.40)' : 'none' }}
        aria-hidden="true"
      />
      {label && <p className="text-xs text-muted">{label}</p>}
    </div>
  );
}
