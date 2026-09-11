import { useLayoutEffect, useState, type ReactNode } from 'react';
/**
 * Floating UI positions fixed portals in viewport pixels. Root CSS zoom scales
 * those coordinates again. Cancel that inherited scale around the positioning
 * wrapper and restore it on the content, preserving both placement and text size.
 * Native browser zoom needs no adjustment: computed CSS zoom remains one.
 */
export function ZoomPortal({ children }: { children: (zoom: number) => ReactNode }) {
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const update = () => {
      const value = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
      setZoom(Number.isFinite(value) && value > 0 ? value : 1);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => observer.disconnect();
  }, []);
  return <div style={{ zoom: 1 / zoom }}>{children(zoom)}</div>;
}
