import { APP_SCHEME } from './app-protocol.js';

/** Only the renderer origin may load in the desktop window. */
export function isAllowedNavigation(candidate: string, rendererUrl: string): boolean {
  try {
    const destination = new URL(candidate);
    const renderer = new URL(rendererUrl);

    // `app:` is a standard scheme inside Chromium but not in Node's URL parser,
    // where `origin` is the literal string "null" for every such URL. Comparing
    // protocol and host explicitly avoids two different hosts both matching.
    if (renderer.protocol === `${APP_SCHEME}:`) {
      return destination.protocol === renderer.protocol
        && destination.host === renderer.host
        && destination.username === ''
        && destination.password === ''
        && destination.pathname === renderer.pathname
        && destination.search === renderer.search;
    }

    // A packaged `file:` renderer is no longer shipped, but a window that ends
    // up on one must still be pinned to exactly its own document.
    if (renderer.protocol === 'file:') {
      return destination.protocol === 'file:' && destination.pathname === renderer.pathname
        && destination.host === renderer.host && destination.search === renderer.search;
    }

    return destination.origin === renderer.origin && destination.protocol === 'http:';
  } catch {
    return false;
  }
}
