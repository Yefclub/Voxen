import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

/**
 * Spinner orbital: dois arcos girando em sentidos opostos.
 * Mais discreto que Loader2 padrão e dá personalidade ao loading state.
 */
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
      aria-label="Carregando"
      className={cn('inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <motion.svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        animate={{ rotate: 360 }}
        transition={{ duration: 1.1, ease: 'linear', repeat: Infinity }}
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
      </motion.svg>
    </span>
  );
}
