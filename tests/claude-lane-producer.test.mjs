import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFeed, consensus, pickCandidate, guardFacts, toRecord, buildPrompt, callModel } from '../scripts/claude-lane/research.mjs';
import { validateLaneRecord, composeCaption } from '../scripts/claude-lane/lane-record.mjs';
import { createGitStore } from '../scripts/claude-lane/git-store.mjs';
import { reconcile } from '../scripts/claude-lane/reconcile.mjs';

const NOW = new Date('2026-10-06T15:00:00Z');
const rss = items => `<rss><channel>${items.map(i => `<item><title><![CDATA[${i.t}]]></title><link>${i.l}</link><description>${i.d}</description><pubDate>${i.p}</pubDate></item>`).join('')}</channel></rss>`;
const bbc = parseFeed(rss([
  { t: 'Earthquake of magnitude 6.8 strikes northern Chile, government says', l: 'https://bbc.co.uk/1', d: 'The quake hit near Antofagasta on Monday, officials said.', p: 'Mon, 06 Oct 2026 10:00:00 GMT' },
  { t: 'Old story', l: 'https://bbc.co.uk/old', d: 'x', p: 'Mon, 01 Oct 2026 10:00:00 GMT' },
]), { source: 'BBC', id: 'bbc' }, NOW.getTime() - 12 * 3600e3);
const dw = parseFeed(rss([
  { t: 'Magnitude 6.8 earthquake strikes northern Chile near Antofagasta', l: 'https://dw.com/2', d: 'Chile government reports no immediate casualties.', p: 'Mon, 06 Oct 2026 11:00:00 GMT' },
]), { source: 'DW', id: 'dw' }, NOW.getTime() - 12 * 3600e3);

test('feed parsing keeps fresh https items only', () => {
  assert.equal(bbc.length, 1); assert.equal(dw.length, 1);
});

test('consensus requires two independent outlets about the same event', () => {
  const c = consensus([...bbc, ...dw]);
  assert.equal(c.length, 1); assert.equal(c[0].sources.length, 2);
  assert.equal(consensus(bbc).length, 0);
});

test('candidate already covered by another lane or the Core v2 queue is not picked', () => {
  const c = consensus([...bbc, ...dw]);
  assert.ok(pickCandidate(c, []));
  assert.equal(pickCandidate(c, [{ id: 'q', headline: 'x', source_urls: ['https://dw.com/2'] }]), null);
});

const goodDraft = {
  headline_en: 'Magnitude 6.8 earthquake strikes northern Chile',
  headline_es: 'Sismo de magnitud 6,8 sacude el norte de Chile',
  caption_en: 'A magnitude 6.8 earthquake struck northern Chile near Antofagasta on Monday. The government reported no immediate casualties.',
  caption_es: 'Un sismo de magnitud 6,8 sacudió el norte de Chile cerca de Antofagasta el lunes. El gobierno no reportó víctimas inmediatas.',
  category: 'World', hashtags: ['#Chile', '#Sismo'],
};

test('fact guard accepts faithful drafts and rejects invented numbers or names', () => {
  const c = consensus([...bbc, ...dw])[0];
  assert.deepEqual(guardFacts(goodDraft, c), []);
  assert.ok(guardFacts({ ...goodDraft, caption_en: 'At least 40 people died in Antofagasta.' }, c).includes('number:40'));
  assert.ok(guardFacts({ ...goodDraft, caption_en: 'The quake hit near Antofagasta, according to Reuters.' }, c).includes('name:Reuters'));
  assert.ok(guardFacts({ ...goodDraft, caption_es: 'Murieron 40 personas.' }, c).includes('numero:40'));
});

test('draft becomes a valid lane record with bilingual caption and both sources', () => {
  const c = consensus([...bbc, ...dw])[0];
  const r = toRecord(goodDraft, c, NOW);
  assert.deepEqual(validateLaneRecord(r), []);
  assert.match(r.content_id, /^claude-20261006-magnitude-6-8-earthquake/);
  assert.deepEqual(r.source_names, ['DW', 'BBC']);
  assert.match(composeCaption(r), /🇪🇸 Un sismo[\s\S]*🇺🇸 A magnitude/);
});

test('prompt restricts the model to the sources', () => {
  const m = buildPrompt(consensus([...bbc, ...dw])[0]);
  assert.match(m[0].content, /ONLY facts stated in the sources/);
  assert.match(m[1].content, /\[1\] DW/);
});

test('model call uses GitHub Models with the job token and parses JSON', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(goodDraft) } }] }) }; };
  const out = await callModel([], { token: 't0k3n', fetchImpl });
  assert.equal(seen.url, 'https://models.github.ai/inference/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer t0k3n');
  assert.equal(out.headline_en, goodDraft.headline_en);
  await assert.rejects(callModel([], { token: 'x', fetchImpl: async () => ({ ok: false, status: 429 }) }), /MODEL_HTTP_429/);
});

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-git-'));
  const g = a => execFileSync('git', a, { cwd: dir });
  g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'README'), 'x'); g(['add', '.']); g(['commit', '-q', '-m', 'init']);
  return dir;
}

test('git store: compare-and-swap, lane-only paths, commit per write', async () => {
  const dir = tempRepo(); const cwd = process.cwd();
  try {
    process.chdir(dir);
    assert.throws(() => createGitStore({ dir: 'queue' }), /OUTSIDE_LANE_DIR/);
    const store = createGitStore({ push: false });
    const c = consensus([...bbc, ...dw])[0];
    const r = toRecord(goodDraft, c, NOW);
    const w1 = await store.write(r, null, 'draft');
    assert.equal(w1.ok, true);
    assert.equal((await store.write(r, null, 'again')).conflict, true);
    assert.equal((await store.write({ ...r, headline: 'y' }, 'deadbeef', 'stale')).conflict, true);
    await assert.rejects(store.write(r, w1.sha, 'bad', [{ path: 'queue/x.jpg', buffer: Buffer.from('x') }]), /EXTRA_FILE_OUTSIDE_LANE/);
    const w2 = await store.write({ ...r, status: 'ready_to_publish', image_url: 'https://x/a.jpg' }, w1.sha, 'ready',
      [{ path: 'claude-lane/media/a.jpg', buffer: Buffer.from('jpg') }]);
    assert.equal(w2.ok, true);
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(files.every(f => f.startsWith('claude-lane/')));
    assert.equal((await store.list())[0].record.status, 'ready_to_publish');
  } finally { process.chdir(cwd); }
});

test('reconciler marks published only on an exact single caption match, never publishes', async () => {
  const c = consensus([...bbc, ...dw])[0];
  const base = { ...toRecord(goodDraft, c, NOW), status: 'publish_unknown', image_url: 'https://x/a.jpg',
    publish_attempt_id: 'a1', reserved_at: '2026-10-06T14:00:00Z' };
  const caption = composeCaption(base);
  const writes = [];
  const store = { async list() { return [{ record: base, sha: 's' }]; }, async write(rec) { writes.push(rec); return { ok: true }; } };
  const igFor = feed => ({ async listRecentMedia() { return feed; }, async publishContainer() { throw new Error('must not publish'); } });
  const now = Date.parse('2026-10-06T15:00:00Z');

  let r = await reconcile({ store, ig: igFor([{ id: '55', caption: `${caption}\n\n#extra`, permalink: 'https://instagram.com/p/z' }]), now, live: true });
  assert.equal(r.results[0].published, '55'); assert.equal(writes[0].status, 'published');

  writes.length = 0;
  r = await reconcile({ store, ig: igFor([{ id: '1', caption: 'other' }]), now, live: true });
  assert.equal(r.results[0].matches, 0); assert.equal(writes.length, 0);

  r = await reconcile({ store, ig: igFor([{ id: '1', caption }, { id: '2', caption }]), now, live: true });
  assert.equal(r.results[0].matches, 2); assert.equal(writes.length, 0);

  r = await reconcile({ store, ig: igFor([]), now: Date.parse('2026-10-06T14:05:00Z'), live: true });
  assert.equal(r.outcome, 'nothing_to_reconcile');
});
