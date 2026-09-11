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
  // report a different number than it paints. NaN and the infinities are not
  // scales, so they fall back rather than propagating into the output.
  const scale = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 100;
  // "Working, amount unknown" covers absent, null and any value that is not a
  // real number: NaN is not zero progress, and announcing aria-valuenow="NaN"
  // or painting translateX(-NaN%) tells both a screen reader and a sighted user
  // nothing. Infinities are treated as the known bounds they are closest to.
  const numeric =
    typeof value === 'number' && !Number.isNaN(value)
      ? value === Infinity
        ? scale
        : value === -Infinity
          ? 0
          : value
      : null;
  const indeterminate = numeric === null;
  const clamped = numeric === null ? null : Math.max(0, Math.min(scale, numeric));
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
      className={cn('relative h-2 w-full overflow-hidden rounded-md bg-muted', className)}
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
