import { cn } from '../../lib/utils';

export function Spinner({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}): React.ReactElement {
  return (
    <span
      role="status"
      aria-label={
        typeof document !== 'undefined' && document.documentElement?.lang?.startsWith('en')
          ? 'Loading'
          : 'Carregando'
      }
      className={cn('inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="animate-spin motion-reduce:animate-none"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="14 60"
          opacity="0.9"
        />
      </svg>
    </span>
  );
}
