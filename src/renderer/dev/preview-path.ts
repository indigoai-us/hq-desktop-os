/** Shared path constant so production code can gate without importing the preview adapter. */
export const DEV_COMPANION_PATH = '/dev/companion';

export function isDevCompanionPath(pathname: string): boolean {
  return pathname === DEV_COMPANION_PATH || pathname === `${DEV_COMPANION_PATH}/`;
}
