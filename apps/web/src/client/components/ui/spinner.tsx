import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Spinner({ className }: { className?: string }): React.ReactElement {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-zinc-500', className)} />;
}
