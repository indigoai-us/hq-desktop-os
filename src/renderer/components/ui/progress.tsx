import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * Progress indicator. Radix sets the fill with an inline `transform`.
 * Production CSP already allows `style-src 'self' 'unsafe-inline'` for this
 * class of positioning — we do not loosen script-src or connect-src for it.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const clamped = Math.max(0, Math.min(100, value ?? 0));

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn('relative h-2 w-full overflow-hidden rounded-none bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-accent transition-transform duration-[var(--motion-state)] ease-[var(--motion-ease-out)]"
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
