// One-off FORMAT TEST for Claude Lane carousels and Reels (owner-authorized
// 2026-10-10). Publishes exactly one carousel and one Reel marked as tests.
// Manual workflow only, gated by an explicit confirmation input. Each publish
// is called ONCE; any failure stops that format and is reported (no retry).
// It does not write to any queue, repository or state file.
const API = 'https://graph.instagram.com/v23.0';
export const CONFIRM = 'PUBLICAR_PRUEBA_FORMATOS';
export const CAPTION_CAROUSEL = 'Prueba técnica de carrusel · Carousel format test. Sin noticia. No news item.';
export const CAPTION_REEL = 'Prueba técnica de Reel · Reel format test. Sin noticia. No news item.';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(path, params, token) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    redirect: 'manual',
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

async function waitFinished(id, token, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${API}/${id}?fields=status_code`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => null);
    const code = body?.status_code;
    if (code === 'FINISHED') return { ok: true };
    if (code === 'ERROR' || code === 'EXPIRED') return { ok: false, reason: code };
    await sleep(5000);
  }
  return { ok: false, reason: 'timeout' };
}

async function publishOnce(igUserId, creationId, token) {
  const r = await post(`${igUserId}/media_publish`, { creation_id: creationId }, token);
  if (r.ok && typeof r.body?.id === 'string') return { outcome: 'published', mediaId: r.body.id };
  return { outcome: 'publish_failed', status: r.status, body: r.body }; // never retried
}

export async function runCarousel({ igUserId, token, slides, caption = CAPTION_CAROUSEL }) {
  const children = [];
  for (const image_url of slides) {
    const c = await post(`${igUserId}/media`, { image_url, is_carousel_item: true }, token);
    if (!c.ok || typeof c.body?.id !== 'string') return { stage: 'child', ok: false, status: c.status, body: c.body };
    const w = await waitFinished(c.body.id, token);
    if (!w.ok) return { stage: 'child_wait', ok: false, reason: w.reason };
    children.push(c.body.id);
  }
  const parent = await post(`${igUserId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, token);
  if (!parent.ok || typeof parent.body?.id !== 'string') return { stage: 'parent', ok: false, status: parent.status, body: parent.body };
  const pw = await waitFinished(parent.body.id, token);
  if (!pw.ok) return { stage: 'parent_wait', ok: false, reason: pw.reason };
  return { stage: 'publish', ...(await publishOnce(igUserId, parent.body.id, token)), children };
}

export async function runReel({ igUserId, token, videoUrl, caption = CAPTION_REEL }) {
  const c = await post(`${igUserId}/media`, { media_type: 'REELS', video_url: videoUrl, caption }, token);
  if (!c.ok || typeof c.body?.id !== 'string') return { stage: 'container', ok: false, status: c.status, body: c.body };
  const w = await waitFinished(c.body.id, token, 60);
  if (!w.ok) return { stage: 'container_wait', ok: false, reason: w.reason };
  return { stage: 'publish', ...(await publishOnce(igUserId, c.body.id, token)) };
}

async function main() {
  if (process.env.CONFIRM_INPUT !== CONFIRM) { console.log('confirmation_missing'); process.exit(1); }
  const token = process.env.IG_CLAUDE_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID || '17841423605720355';
  if (!token) { console.log('secret_missing'); process.exit(1); }
  const base = 'https://raw.githubusercontent.com/55c8ck9mgp-maker/matrix24-media/main/claude-lane/media/';
  const slides = [
    base + 'claude-20261010-verstappen-takes-singapore-grand-prix-pole.jpg',
    base + 'claude-20261010-verstappen-wins-rain-hit-singapore-sprint.jpg',
  ];
  const carousel = await runCarousel({ igUserId, token, slides });
  console.log(JSON.stringify({ format: 'carousel', ...carousel }));
  const reel = await runReel({ igUserId, token, videoUrl: base + 'format-test/reel-test.mp4' });
  console.log(JSON.stringify({ format: 'reel', ...reel }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `carousel: ${carousel.outcome ?? carousel.stage}\nreel: ${reel.outcome ?? reel.stage}\n`);
  }
  process.exit(carousel.outcome === 'published' && reel.outcome === 'published' ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.log(`format_test_failed: ${e.message}`); process.exit(1); });
