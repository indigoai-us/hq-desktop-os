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
  max,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  // A caller-supplied scale is the scale: clamping 50-of-200 to 100 would
  // report a different number than it paints.
  const scale = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 100;
  // Absent or null value means "working, amount unknown". Forcing it to 0 would
  // announce definite no-progress and paint an empty bar as if that were known.
  const indeterminate = value === null || value === undefined;
  const clamped = indeterminate ? null : Math.max(0, Math.min(scale, value));
  // One normalized ratio drives both the fill and what is announced.
  const percent = clamped === null ? 0 : (clamped / scale) * 100;

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={clamped}
      max={scale}
      aria-valuemin={0}
      aria-valuemax={scale}
      aria-valuenow={clamped ?? undefined}
      className={cn('relative h-2 w-full overflow-hidden rounded-none bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-accent transition-transform duration-[var(--motion-state)] ease-[var(--motion-ease-out)]"
        data-indeterminate={indeterminate ? '' : undefined}
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
