/** Only the renderer origin may load in the desktop window. */
export function isAllowedNavigation(candidate: string, rendererUrl: string): boolean {
  try {
    const destination = new URL(candidate);
    const renderer = new URL(rendererUrl);
    if (renderer.protocol === 'file:') {
      return destination.protocol === 'file:' && destination.pathname === renderer.pathname
        && destination.host === renderer.host && destination.search === renderer.search;
    }
    return destination.origin === renderer.origin && destination.protocol === 'http:';
  } catch {
    return false;
  }
}
