import {
  REVIEWED_HTTPS_LINKS,
  resolvePlatformClient,
  type PlatformClient,
  type PlatformResult,
} from '../shared/platform';

/** Renderer entry to the typed platform boundary. Missing preload => fail closed. */
export function getPlatformClient(): PlatformClient {
  return resolvePlatformClient(window.hqDesktop);
}

export async function openReviewedDocsLink(
  client: PlatformClient,
): Promise<PlatformResult<void>> {
  return client.openExternal(REVIEWED_HTTPS_LINKS[0]);
}
