/** Shared path constant so production code can gate without importing the gallery module. */
export const DEV_COMPONENT_GALLERY_PATH = '/dev/components';

export function isDevGalleryPath(pathname: string): boolean {
  return pathname === DEV_COMPONENT_GALLERY_PATH || pathname === `${DEV_COMPONENT_GALLERY_PATH}/`;
}
