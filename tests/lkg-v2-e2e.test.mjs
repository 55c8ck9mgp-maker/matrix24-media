import test from 'node:test';
import assert from 'node:assert/strict';

function makeHarness() {
  const counts = { admission:0, queue:0, media_generation:0, reservation:0, instagram_post:0, media_id:0, archive:0 };
  const queue = new Map();
  const attempts = new Map();

  return {
    counts,
    admit(contentId) {
      if (queue.has(contentId)) return queue.get(contentId);
      counts.admission++; counts.queue++;
      const r={content_id:contentId,status:'blocked_media',account_id:'17841423605720355'};
      queue.set(contentId,r); return r;
    },
    generateMedia(contentId) {
      const r=queue.get(contentId);
      if (!r || r.status!=='blocked_media') throw new Error('MEDIA_NOT_ELIGIBLE');
      counts.media_generation++;
      Object.assign(r,{status:'ready_to_publish',public_image_url:'https://example.invalid/fixture.jpg'});
      return r;
    },
    reserve(contentId, attemptId) {
      const r=queue.get(contentId);
      if (!r || r.status!=='ready_to_publish' || r.publish_attempt_id) throw new Error('NOT_READY');
      counts.reservation++; r.status='publishing'; r.publish_attempt_id=attemptId; attempts.set(attemptId,contentId); return r;
    },
    post(contentId, attemptId, outcome='success') {
      const r=queue.get(contentId);
      if (!r || r.status!=='publishing' || r.publish_attempt_id!==attemptId || attempts.get(attemptId)!==contentId) throw new Error('OWNERSHIP_CONFLICT');
      if (r.external_write_used) throw new Error('POST_ALREADY_USED');
      r.external_write_used=true; counts.instagram_post++;
      if (outcome==='ambiguous') { r.status='publish_unknown'; return null; }
      const id='18135178228630348'; counts.media_id++; return id;
    },
    archive(contentId, attemptId, mediaId) {
      const r=queue.get(contentId);
      if (!r || r.publish_attempt_id!==attemptId || !/^\d+$/.test(mediaId)) throw new Error('ARCHIVE_BINDING_CONFLICT');
      if (r.archive_done) throw new Error('ARCHIVE_ALREADY_DONE');
      counts.archive++; r.archive_done=true; r.status='published'; r.instagram_media_id=mediaId; return r;
    },
    get(contentId){ return queue.get(contentId); }
  };
}

test('E2E LKG v2 exact happy-path cardinality', () => {
  const h=makeHarness(), id='matrix24-e2e-fixture';
  h.admit(id);
  h.admit(id); // duplicate admission must be idempotent
  h.generateMedia(id);
  h.reserve(id,'attempt-1');
  const mediaId=h.post(id,'attempt-1');
  h.archive(id,'attempt-1',mediaId);
  assert.deepEqual(h.counts,{admission:1,queue:1,media_generation:1,reservation:1,instagram_post:1,media_id:1,archive:1});
  assert.equal(h.get(id).status,'published');
});

test('E2E LKG v2 ownership conflict cannot mutate or post', () => {
  const h=makeHarness(), id='matrix24-owner-fixture';
  h.admit(id); h.generateMedia(id); h.reserve(id,'owner-a');
  assert.throws(()=>h.post(id,'owner-b'),/OWNERSHIP_CONFLICT/);
  assert.equal(h.counts.instagram_post,0);
  assert.equal(h.get(id).publish_attempt_id,'owner-a');
});

test('E2E LKG v2 ambiguous call consumes the one POST and cannot retry', () => {
  const h=makeHarness(), id='matrix24-ambiguous-fixture';
  h.admit(id); h.generateMedia(id); h.reserve(id,'attempt-a');
  assert.equal(h.post(id,'attempt-a','ambiguous'),null);
  assert.equal(h.get(id).status,'publish_unknown');
  assert.throws(()=>h.post(id,'attempt-a'),/OWNERSHIP_CONFLICT|POST_ALREADY_USED/);
  assert.throws(()=>h.post(id,'attempt-b'),/OWNERSHIP_CONFLICT/);
  assert.equal(h.counts.instagram_post,1);
  assert.equal(h.counts.media_id,0);
  assert.equal(h.counts.archive,0);
});

test('E2E LKG v2 missing permalink is secondary and does not reopen publication', () => {
  const h=makeHarness(), id='matrix24-permalink-fixture';
  h.admit(id); h.generateMedia(id); h.reserve(id,'attempt-a');
  const mediaId=h.post(id,'attempt-a'); h.archive(id,'attempt-a',mediaId);
  assert.equal(h.get(id).status,'published');
  assert.equal(h.get(id).instagram_permalink,undefined);
  assert.throws(()=>h.post(id,'attempt-a'));
  assert.equal(h.counts.instagram_post,1);
});
