import { cn } from '../../lib/utils';

interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

export function Logo({ size = 32, withWordmark = true, className }: LogoProps): React.ReactElement {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <img
          src="/voxen-256.png"
          alt="Voxen"
          width={size}
          height={size}
          className="relative rounded-lg select-none pointer-events-none"
          draggable={false}
        />
      </div>
      {withWordmark && (
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight font-display">Voxen</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] mt-1">
            base de conhecimento
          </span>
        </div>
      )}
    </div>
  );
}
