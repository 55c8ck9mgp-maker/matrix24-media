import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  shortcodeFromPermalink, planReconciliation, buildEnrichedRecord, fetchAccountMedia, applyEnrichment
} from '../scripts/reconcile-instagram-posts.mjs';

const token = 'test-token-value-is-never-sent-to-a-real-provider';
const user = 'matrix24global';
const noSleep = async () => {};

const published = {
  content_id: 'matrix24-fixture-published', status: 'published', caption: 'Heavy rain floods Bangkok.',
  instagram_permalink: 'https://www.instagram.com/p/DdwsQWYFLsg/', published_at: '2026-09-26T18:35:00Z',
  publish_attempt_history: [{ timestamp: '2026-09-26T18:35:00Z', stage: 'instagram_publish', result: 'published' }]
};
const publishing = {
  content_id: 'matrix24-fixture-publishing', status: 'publishing', caption: 'Javelin gold for Sri Lanka.',
  publish_attempt_id: 'att-1', publishing_started_at: '2026-09-28T22:35:54Z', publish_attempt_history: []
};
const igPublished = { id: '18000000000000001', username: user, permalink: 'https://www.instagram.com/p/DdwsQWYFLsg/', caption: 'Heavy rain floods Bangkok. #MATRIX24', timestamp: '2026-09-26T18:34:10+0000' };
const igJavelin = { id: '18000000000000002', username: user, permalink: 'https://www.instagram.com/p/AAAA/', caption: 'Javelin gold for Sri Lanka. #Sports', timestamp: '2026-09-28T22:40:00+0000' };
const rec = (record, name = record.content_id) => ({ path: `queue/${name}.json`, record });

test('shortcode is parsed only from Instagram post permalinks', () => {
  assert.equal(shortcodeFromPermalink('https://www.instagram.com/p/Ddyo_yUgETX/'), 'Ddyo_yUgETX');
  assert.equal(shortcodeFromPermalink('https://instagram.com/reel/abc-1'), 'abc-1');
  assert.equal(shortcodeFromPermalink('https://evil.example/p/abc/'), null);
  assert.equal(shortcodeFromPermalink(null), null);
});

test('published record with permalink gets its media ID only from an exact shortcode match', () => {
  const { enrich, report } = planReconciliation({ records: [rec(published)], media: [igPublished] });
  assert.equal(enrich.length, 1);
  assert.equal(enrich[0].media.id, igPublished.id);
  assert.equal(report[0].result, 'media_id_confirmed');
});

test('a caption match alone never fills a media ID on a published record', () => {
  const other = { ...igPublished, permalink: 'https://www.instagram.com/p/OTHER/' };
  const { enrich, report } = planReconciliation({ records: [rec(published)], media: [other] });
  assert.equal(enrich.length, 0);
  assert.equal(report[0].result, 'unresolved');
  assert.equal(report[0].reason, 'permalink_not_in_account_media');
});

test('an unmatched published record keeps its status; it is never demoted to publish_unknown', () => {
  const { enrich, report } = planReconciliation({ records: [rec(published)], media: [], oldestFetched: '2026-09-27T00:00:00Z' });
  assert.equal(enrich.length, 0);
  assert.deepEqual(report, [{ content_id: published.content_id, status: 'published', result: 'unresolved', reason: 'outside_fetched_window' }]);
});

test('publishing records are report-only, including a clear caption match', () => {
  const { enrich, report } = planReconciliation({ records: [rec(publishing)], media: [igJavelin] });
  assert.equal(enrich.length, 0);
  assert.equal(report[0].result, 'candidate_caption_match');
  assert.equal(report[0].write, 'none_publisher_owned');
  assert.equal(report[0].instagram_media_id, igJavelin.id);
});

test('a caption post older than the reservation is not a candidate', () => {
  const old = { ...igJavelin, timestamp: '2026-09-27T00:00:00+0000' };
  const { report } = planReconciliation({ records: [rec(publishing)], media: [old] });
  assert.equal(report[0].result, 'no_candidate');
});

test('two account posts for one record are reported as a suspected duplicate', () => {
  const twin = { ...igJavelin, id: '18000000000000003', permalink: 'https://www.instagram.com/p/BBBB/' };
  const { report } = planReconciliation({ records: [rec(publishing)], media: [igJavelin, twin] });
  assert.equal(report[0].result, 'duplicate_suspected');
  assert.deepEqual(report[0].media_ids, [igJavelin.id, twin.id]);
});

test('records already carrying a media ID, and non-publication statuses, are skipped', () => {
  const done = { ...published, instagram_media_id: '17901642846667497' };
  const ready = { ...publishing, status: 'ready_to_publish' };
  const { enrich, report } = planReconciliation({ records: [rec(done), rec(ready)], media: [igPublished] });
  assert.equal(enrich.length, 0);
  assert.equal(report.length, 0);
});

test('the enriched record is an owned Recovery write that adds only the media ID and one history entry', () => {
  const built = buildEnrichedRecord(published, igPublished, { now: '2026-09-29T11:00:00Z', runId: '1' });
  assert.equal(built.ok, true);
  assert.equal(built.after.instagram_media_id, igPublished.id);
  assert.equal(built.after.status, 'published');
  assert.equal(built.after.instagram_permalink, published.instagram_permalink);
  assert.equal(built.after.publish_attempt_history.length, 2);
  assert.equal(built.after.publish_attempt_history.at(-1).stage, 'instagram_reconciliation');
});

test('enrichment refuses to overwrite an existing media ID', () => {
  const built = buildEnrichedRecord({ ...published, instagram_media_id: '17000000000000009' }, igPublished, { now: 'x' });
  assert.equal(built.ok, false);
  assert.ok(built.violations.includes('terminal_evidence_changed:instagram_media_id'));
});

test('every real queue record that would be enriched passes the ownership check', () => {
  for (const f of fs.readdirSync('queue').filter(n => n.endsWith('.json'))) {
    const r = JSON.parse(fs.readFileSync(`queue/${f}`, 'utf8'));
    if (r.status !== 'published' || r.instagram_media_id || !shortcodeFromPermalink(r.instagram_permalink)) continue;
    const media = { id: '18000000000000009', username: user, permalink: r.instagram_permalink, timestamp: r.published_at };
    const built = buildEnrichedRecord(r, media, { now: '2026-09-29T11:00:00Z' });
    assert.equal(built.ok, true, `${f}: ${JSON.stringify(built.violations)}`);
  }
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('account media read retries 5xx up to 3 times, then fails closed', async () => {
  let calls = 0;
  const r = await fetchAccountMedia({ accessToken: token, expectedUsername: user, sleep: noSleep, fetchImpl: async () => { calls++; return jsonResponse({}, 503); } });
  assert.equal(calls, 3);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'graph_unavailable');
});

test('account media read does not retry authentication errors and never echoes the token', async () => {
  let calls = 0;
  const r = await fetchAccountMedia({ accessToken: token, expectedUsername: user, sleep: noSleep, fetchImpl: async () => { calls++; return jsonResponse({}, 401); } });
  assert.equal(calls, 1);
  assert.deepEqual(r, { ok: false, reason: 'authentication' });
  assert.equal(JSON.stringify(r).includes(token), false);
});

test('account media read fails closed on media from another account', async () => {
  const r = await fetchAccountMedia({ accessToken: token, expectedUsername: user, sleep: noSleep,
    fetchImpl: async () => jsonResponse({ data: [igPublished, { ...igJavelin, username: 'someone_else' }] }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'identity_mismatch');
});

test('pagination is followed only on the Graph origin', async () => {
  const urls = [];
  const r = await fetchAccountMedia({ accessToken: token, expectedUsername: user, sleep: noSleep, fetchImpl: async url => {
    urls.push(url);
    return jsonResponse({ data: [igPublished], paging: { next: 'https://attacker.example/steal' } });
  } });
  assert.equal(urls.length, 1);
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);
});

function fakeGitHub(initial, { conflicts = 0, putThrows = 0 } = {}) {
  const state = { record: structuredClone(initial), sha: 'sha-1', puts: 0 };
  const fetchImpl = async (url, init = {}) => {
    if (!init.method || init.method === 'GET') {
      return jsonResponse({ sha: state.sha, content: Buffer.from(JSON.stringify(state.record)).toString('base64') });
    }
    state.puts++;
    const body = JSON.parse(init.body);
    if (putThrows > 0) { // the write lands, but the response is lost
      putThrows--;
      state.record = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      state.sha = `sha-${state.puts + 1}`;
      throw new TypeError('network');
    }
    if (conflicts > 0 || body.sha !== state.sha) { conflicts--; state.sha = `sha-other-${state.puts}`; return jsonResponse({ message: 'sha mismatch' }, 409); }
    state.record = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    state.sha = `sha-${state.puts + 1}`;
    return jsonResponse({ commit: { sha: 'c1' } });
  };
  return { state, fetchImpl };
}

const item = { queue_path: 'queue/matrix24-fixture-published.json', content_id: published.content_id, shortcode: 'DdwsQWYFLsg', media: igPublished };

test('apply writes once with the fresh SHA', async () => {
  const gh = fakeGitHub(published);
  const r = await applyEnrichment({ repo: 'o/r', token: 't', item, now: '2026-09-29T11:00:00Z', fetchImpl: gh.fetchImpl, sleep: noSleep });
  assert.equal(r.result, 'written');
  assert.equal(gh.state.puts, 1);
  assert.equal(gh.state.record.instagram_media_id, igPublished.id);
});

test('apply re-reads after a SHA conflict and gives up after 3 attempts', async () => {
  const gh = fakeGitHub(published, { conflicts: 5 });
  const r = await applyEnrichment({ repo: 'o/r', token: 't', item, now: 'x', fetchImpl: gh.fetchImpl, sleep: noSleep });
  assert.equal(r.result, 'error');
  assert.match(r.reason, /sha_conflict_after_3_attempts/);
  assert.equal(gh.state.puts, 3);
});

test('a lost PUT response resolves to already_reconciled, not a second write', async () => {
  const gh = fakeGitHub(published, { putThrows: 1 });
  const r = await applyEnrichment({ repo: 'o/r', token: 't', item, now: 'x', fetchImpl: gh.fetchImpl, sleep: noSleep });
  assert.equal(r.result, 'already_reconciled');
  assert.equal(gh.state.puts, 1);
});

test('apply skips a record whose status moved away from published', async () => {
  const gh = fakeGitHub({ ...published, status: 'publish_unknown' });
  const r = await applyEnrichment({ repo: 'o/r', token: 't', item, now: 'x', fetchImpl: gh.fetchImpl, sleep: noSleep });
  assert.equal(r.result, 'skipped');
  assert.equal(gh.state.puts, 0);
});

test('reconciliation workflow is manual-only and writes only in the gated apply job', () => {
  const wf = fs.readFileSync('.github/workflows/instagram-queue-reconciliation.yml', 'utf8');
  assert.equal(/^\s*schedule:/m.test(wf), false);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /^permissions:\n\s+contents: read/m);
  assert.match(wf, /if: \$\{\{ inputs\.apply \}\}/);
  assert.equal(/git push/.test(wf), false);
});

test('the Metricool recovery workflow and its legacy writer are gone', () => {
  assert.equal(fs.existsSync('.github/workflows/metricool-recovery.yml'), false);
  assert.equal(fs.existsSync('scripts/invoke-metricool-recovery.mjs'), false);
});
