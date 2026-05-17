import { motion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Wrapper de entrada de página: fade + slide leve + sutil scale.
 * Usar como container raiz de cada page component pra trazer vida ao roteamento.
 */
export function AnimatedPage({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Container que faz staggered entrance dos filhos diretos.
 * Cada filho aparece com 60ms de atraso entre si.
 */
export function StaggerContainer({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}): React.ReactElement {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.06, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: {
          opacity: 1,
          y: 0,
          transition: { type: 'spring', stiffness: 220, damping: 24 },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
