export const ELIGIBLE_STATUSES = new Set(["blocked_media", "ready_to_publish"]);

export function validateUniqueContentIds(records) {
  const ids = new Set();
  for (const record of records) {
    const id = record?.story?.content_id;
    if (typeof id !== "string" || !id.trim() || ids.has(id)) {
      const error = new Error("QUEUE_ID_INVALID_OR_DUPLICATE");
      error.code = "QUEUE_ID_INVALID_OR_DUPLICATE";
      throw error;
    }
    ids.add(id);
  }
  return true;
}

export function storyPriority(story = {}) {
  const breaking =
    story.breaking === true ||
    String(story.priority || "").toLowerCase() === "breaking";
  const status = String(story.status || "").toLowerCase();
  if (breaking && status === "blocked_media") return 400;
  if (breaking && status === "ready_to_publish") return 390;
  if (status === "blocked_media") return 300;
  if (status === "ready_to_publish") return 200;
  return 0;
}

export function selectQueueRecord(records) {
  return (
    records
      .filter((record) => {
        const story = record?.story;
        if (!story) return false;
        if (story.instagram_media_id) return false;
        const status = String(story.status || "").toLowerCase();
        if (status === "published") return false;
        if (status === "ready_to_publish" && story.public_image_url) return false;
        return ELIGIBLE_STATUSES.has(status);
      })
      .sort((a, b) => {
        const priorityDiff = storyPriority(b.story) - storyPriority(a.story);
        if (priorityDiff !== 0) return priorityDiff;
        const ta = Date.parse(a.story?.timestamp || "") || 0;
        const tb = Date.parse(b.story?.timestamp || "") || 0;
        return tb - ta;
      })[0] || null
  );
}

export function assertShaMatch(record, currentSha) {
  if (!record?.sha || !currentSha || record.sha !== currentSha) {
    const error = new Error("SHA_CONFLICT");
    error.code = "SHA_CONFLICT";
    throw error;
  }
}

export function reserveMedia(record, claimId, startedAt) {
  if (!record?.story) throw new Error("QUEUE_CONTENT_INVALID");
  const next = structuredClone(record);
  next.story.status = "processing_media";
  next.story.media_claim = { id: claimId, started_at: startedAt };
  return next;
}

export function completeMedia(record, options = {}) {
  if (!record?.story) throw new Error("QUEUE_CONTENT_INVALID");
  const next = structuredClone(record);
  next.story.status = "ready_to_publish";
  next.story.public_image_url = options.publicImageUrl;
  next.story.image_filename = options.imageFilename;
  next.story.media_ready_at = options.readyAt;
  delete next.story.media_claim;

  if (Number.isInteger(options.sizeBytes)) {
    next.story.image_spec = {
      format: "JPEG",
      mode: "RGB",
      width: 1080,
      height: 1350,
      size_bytes: options.sizeBytes,
      alpha: false
    };
  }

  const history = Array.isArray(next.story.publish_attempt_history)
    ? next.story.publish_attempt_history
    : [];

  history.push({
    timestamp: options.readyAt,
    stage: "media_pipeline",
    result: options.reusedExistingMedia ? "reused_existing_media" : "success",
    public_image_url: options.publicImageUrl,
    image_filename: options.imageFilename
  });
  next.story.publish_attempt_history = history.slice(-50);
  return next;
}

export function preserveClaimOnFailure(record) {
  if (!record?.story) throw new Error("QUEUE_CONTENT_INVALID");
  return structuredClone(record);
}

export function runFixtureScenario(payload) {
  const records = structuredClone(payload?.records || []);
  validateUniqueContentIds(records);

  const selected = selectQueueRecord(records);
  if (!selected) {
    return {
      action: "none",
      records,
      pending_recovery: records.filter(
        (r) => r?.story?.status === "processing_media"
      ).length
    };
  }

  if (typeof payload?.current_sha !== "string" || !payload.current_sha) {
    const error = new Error("CURRENT_SHA_REQUIRED");
    error.code = "CURRENT_SHA_REQUIRED";
    throw error;
  }

  assertShaMatch(selected, payload.current_sha);

  const claimId = payload?.claim_id || "fixture-claim";
  const now = payload?.now || "2026-09-24T00:00:00.000Z";
  const claimed = reserveMedia(selected, claimId, now);

  if (payload?.simulate_failure_after_claim === true) {
    return {
      action: "media_failed",
      selected_path: selected.path,
      record: preserveClaimOnFailure(claimed)
    };
  }

  const existing = payload?.existing_media === true;
  const contentId = selected.story.content_id;
  const filename =
    selected.story.image_filename || ("matrix24-fixture-" + contentId + ".jpg");
  const publicImageUrl =
    selected.story.public_image_url ||
    ("https://staging.invalid/matrix24/" + filename);

  return {
    action: existing ? "already_ready" : "media_created",
    selected_path: selected.path,
    record: completeMedia(claimed, {
      publicImageUrl,
      imageFilename: filename,
      readyAt: now,
      reusedExistingMedia: existing,
      sizeBytes: existing ? null : 123456
    })
  };
}
