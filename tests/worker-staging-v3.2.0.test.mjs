import test from "node:test";
import assert from "node:assert/strict";

import {
  assertShaMatch,
  runFixtureScenario,
  selectQueueRecord,
  validateUniqueContentIds
} from "../worker/staging/v3.2.0/src/core.js";

function record(overrides = {}) {
  return {
    path: "fixture.json",
    sha: "sha-1",
    story: {
      timestamp: "2026-09-24T00:00:00.000Z",
      content_id: "fixture-1",
      status: "blocked_media",
      headline: "Fixture headline",
      verified_source_urls: ["https://example.com/source"],
      ...overrides
    }
  };
}

test("normal media claim completes to ready_to_publish", () => {
  const result = runFixtureScenario({
    records: [record()],
    current_sha: "sha-1",
    claim_id: "claim-1",
    now: "2026-09-24T00:01:00.000Z"
  });

  assert.equal(result.action, "media_created");
  assert.equal(result.record.story.status, "ready_to_publish");
  assert.equal(result.record.story.media_claim, undefined);
  assert.match(result.record.story.public_image_url, /^https:\/\/staging\.invalid\//);
});

test("SHA conflict blocks the claim", () => {
  assert.throws(() => assertShaMatch(record(), "sha-other"), /SHA_CONFLICT/);
});

test("existing deterministic media is reused", () => {
  const result = runFixtureScenario({
    records: [
      record({
        status: "ready_to_publish",
        public_image_url: null,
        image_filename: "existing.jpg"
      })
    ],
    current_sha: "sha-1",
    existing_media: true,
    now: "2026-09-24T00:01:00.000Z"
  });

  assert.equal(result.action, "already_ready");
  assert.equal(
    result.record.story.publish_attempt_history.at(-1).result,
    "reused_existing_media"
  );
});

test("failure after claim preserves durable media_claim", () => {
  const result = runFixtureScenario({
    records: [record()],
    current_sha: "sha-1",
    claim_id: "claim-durable",
    simulate_failure_after_claim: true
  });

  assert.equal(result.action, "media_failed");
  assert.equal(result.record.story.status, "processing_media");
  assert.equal(result.record.story.media_claim.id, "claim-durable");
});

test("ready_to_publish with media URL is not selected", () => {
  const candidate = record({
    status: "ready_to_publish",
    public_image_url: "https://staging.invalid/matrix24/already.jpg"
  });
  assert.equal(selectQueueRecord([candidate]), null);
});

test("processing_media is never selected by age", () => {
  const candidate = record({
    status: "processing_media",
    media_claim: {
      id: "old-claim",
      started_at: "2020-01-01T00:00:00.000Z"
    }
  });
  assert.equal(selectQueueRecord([candidate]), null);
});

test("duplicate content_id is rejected", () => {
  const a = record({ content_id: "duplicate" });
  const b = {
    ...record({ content_id: "duplicate" }),
    path: "fixture-2.json",
    sha: "sha-2"
  };
  assert.throws(
    () => validateUniqueContentIds([a, b]),
    /QUEUE_ID_INVALID_OR_DUPLICATE/
  );
});
