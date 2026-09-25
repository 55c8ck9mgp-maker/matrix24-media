import { getDirectMedia } from '../worker/staging/reliability/direct-media-client.mjs';

export async function reconcileInstagramMedia({ mediaId, accessToken, expectedUsername, fetchImpl = fetch }) {
  const lookup = await getDirectMedia({ mediaId, accessToken, fetchImpl });
  if (lookup.kind !== 'ig_media') return { status: 'unknown', reason: lookup.reason || lookup.kind };
  if (lookup.username !== expectedUsername) return { status: 'unknown', reason: 'identity_mismatch' };
  return { status: 'confirmed', media_id: lookup.id, permalink: lookup.permalink || null, username: lookup.username };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = await reconcileInstagramMedia({ mediaId: process.env.MEDIA_ID, accessToken: process.env.IG_READ_TOKEN, expectedUsername: process.env.IG_USERNAME });
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'confirmed' ? 0 : 2;
}
