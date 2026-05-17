import { useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';

/**
 * Conta-gotas animado de número (0 → value) com spring suave.
 * Refaz a animação se `value` mudar.
 */
export function NumberTicker({
  value,
  className,
}: {
  value: number;
  className?: string;
}): React.ReactElement {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => Math.round(v).toString());

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, mv]);

  return <motion.span className={className}>{display}</motion.span>;
}
