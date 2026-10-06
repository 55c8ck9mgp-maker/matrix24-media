// Public image hosting for the Claude Lane: the JPEG is committed to this public
// repository and served by raw.githubusercontent.com (verified 2026-10-06:
// HTTP 200, content-type image/jpeg, accepted by Instagram for a private
// container). Free, no extra credentials.
export const REPO = '55c8ck9mgp-maker/matrix24-media';
export const MEDIA_DIR = 'claude-lane/media';

export function mediaPath(contentId) {
  if (!/^claude-\d{8}-[a-z0-9-]+$/.test(contentId)) throw new Error('BAD_CONTENT_ID');
  return `${MEDIA_DIR}/${contentId}.jpg`;
}

export function mediaUrl(contentId, ref = 'main') {
  return `https://raw.githubusercontent.com/${REPO}/${ref}/${mediaPath(contentId)}`;
}
