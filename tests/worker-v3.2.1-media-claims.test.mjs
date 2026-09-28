import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const DEPLOYED = "worker/backups/v3.2.0/deployed/worker.js";
const RELEASE = "worker/releases/v3.2.1/worker.js";

// Evaluates a Worker module in isolation and exposes its private functions.
function loadWorker(file, { fetch = async () => { throw new Error("unexpected fetch"); }, logs = [] } = {}) {
  const source = fs
    .readFileSync(file, "utf8")
    .replace("export default {", "globalThis.__handlers = {");
  const context = vm.createContext({
    crypto,
    fetch,
    Response,
    TextEncoder,
    TextDecoder,
    URL,
    AbortSignal,
    atob,
    btoa,
    console: {
      warn: (line) => logs.push(["warn", JSON.parse(line)]),
      error: (line) => logs.push(["error", JSON.parse(line)]),
      log: () => {}
    }
  });
  vm.runInContext(
    `${source}\nglobalThis.__internals = { selectQueueRecord, processQueue, VERSION };`,
    context
  );
  return context.__internals;
}

function record(overrides = {}) {
  return {
    path: "queue/fixture.json",
    sha: "sha-1",
    error: null,
    story: {
      timestamp: "2026-09-28T00:00:00.000Z",
      content_id: "matrix24-fixture",
      status: "blocked_media",
      headline: "Fixture headline",
      verified_source_urls: ["https://example.com/source"],
      ...overrides
    }
  };
}

const stuck = () =>
  record({
    status: "processing_media",
    media_claim: { id: "original-claim", started_at: "2026-09-28T00:00:00.000Z" }
  });

test("deployed v3.2.0 re-selects a stuck processing_media claim (the bug being fixed)", () => {
  const { selectQueueRecord } = loadWorker(DEPLOYED);
  assert.equal(selectQueueRecord([stuck()])?.story.content_id, "matrix24-fixture");
});

test("v3.2.1 never selects processing_media, whatever its age", () => {
  const { selectQueueRecord, VERSION } = loadWorker(RELEASE);
  assert.equal(VERSION, "3.2.1");
  assert.equal(selectQueueRecord([stuck()]), null);
});

test("v3.2.1 never overwrites a durable media_claim even if status is malformed", () => {
  const { selectQueueRecord } = loadWorker(RELEASE);
  const malformed = record({ media_claim: { id: "must-not-overwrite", started_at: "2020-01-01T00:00:00.000Z" } });
  assert.equal(selectQueueRecord([malformed]), null);
});

test("v3.2.1 still selects unclaimed blocked_media alongside a stuck claim", () => {
  const { selectQueueRecord } = loadWorker(RELEASE);
  const fresh = record({ content_id: "matrix24-fresh" });
  assert.equal(selectQueueRecord([stuck(), fresh])?.story.content_id, "matrix24-fresh");
});

test("v3.2.1 cron cycle reports a stuck claim without writing, rendering or clearing it", async () => {
  const story = stuck().story;
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push([options.method || "GET", String(url)]);
    const body = String(url).endsWith("/contents/queue")
      ? [{ type: "file", name: "matrix24-fixture.json", path: "queue/matrix24-fixture.json", sha: "sha-1", url: "https://api.github.com/item" }]
      : { sha: "sha-1", path: "queue/matrix24-fixture.json", content: btoa(JSON.stringify(story)) };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const logs = [];
  const { processQueue } = loadWorker(RELEASE, { fetch, logs });

  const result = await processQueue({ GITHUB_TOKEN: "test" });

  assert.equal(result.success, true);
  assert.equal(result.action, "none");
  assert.equal(result.pending_recovery, 1);
  assert.deepEqual(calls.map(([method]) => method), ["GET", "GET"]);
  const [level, event] = logs[0];
  assert.equal(level, "warn");
  assert.equal(event.event, "matrix24_media_claim_pending_reconciliation");
  assert.deepEqual(event.records, [
    { content_id: "matrix24-fixture", claim_id: "original-claim", started_at: "2026-09-28T00:00:00.000Z" }
  ]);
});
