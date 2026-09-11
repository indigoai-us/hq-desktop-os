import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { ZoomPortal } from '@/lib/zoom-portal';
import { cn } from '@/lib/utils';

/**
 * Tooltip content is portaled and positioned with Radix inline styles
 * (`transform` / coordinates). That is covered by the existing
 * `style-src 'unsafe-inline'` allowlist — CSP is not weakened further.
 */
function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  style,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <ZoomPortal>{(zoom) => <TooltipPrimitive.Content
        style={{ ...style, zoom }}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-fit max-w-xs rounded-none border border-border bg-foreground px-3 py-1.5 text-hq-canvas font-medium text-balance text-background',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>}</ZoomPortal>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
