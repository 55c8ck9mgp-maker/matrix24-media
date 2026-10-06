// Generates the story illustration with Cloudflare Workers AI (FLUX.1 schnell, free
// daily allocation). Returns a JPEG Buffer or null; any failure falls back to a
// card without illustration. The prompt is wrapped with fixed safety rules.
export const MODEL = '@cf/black-forest-labs/flux-1-schnell';
export const SAFETY = 'Generic editorial illustration. No text, no letters, no numbers, no signage, no logos, no flags, no insignia, '
  + 'no identifiable real people, no faces in close-up, no gore, no depiction of a real specific event as if it were a news photo.';

export function buildPrompt(imagePrompt) {
  return `${String(imagePrompt).slice(0, 700)}. ${SAFETY} Cinematic lighting, high detail, wide composition.`;
}

export async function generateImage(imagePrompt, { token, accountId, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  if (!imagePrompt || !token || !accountId) return null;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: buildPrompt(imagePrompt), steps: 4 }),
    });
    const body = await res.json().catch(() => null);
    const b64 = body?.result?.image;
    return res.ok && typeof b64 === 'string' && b64.length > 1000 ? Buffer.from(b64, 'base64') : null;
  } catch { return null; } finally { clearTimeout(t); }
}
