export const ACTORS=Object.freeze({
  EDITORIAL:"core-v2/editorial-approval",
  MEDIA:"core-v2/media-builder",
  ADMISSION:"core-v2/queue-admission",
  PUBLISHER:"core-v2/claude-publisher",
  RECONCILER:"core-v2/reconciler",
  HUMAN_RECOVERY:"human/recovery-decision",
  AUDITOR:"core-v2/auditor",
  CHATGPT:"assistant/chatgpt"
});

export const TRANSITION_ACTOR=Object.freeze({
 "candidate->approved":ACTORS.EDITORIAL,
 "candidate->discarded":ACTORS.EDITORIAL,
 "approved->media_ready":ACTORS.MEDIA,
 "approved->discarded":ACTORS.EDITORIAL,
 "media_ready->ready_to_publish":ACTORS.ADMISSION,
 "ready_to_publish->publishing":ACTORS.PUBLISHER,
 "publishing->published":ACTORS.RECONCILER,
 "publishing->publish_unknown":ACTORS.RECONCILER,
 "publish_unknown->published":ACTORS.RECONCILER,
 "publish_unknown->discarded":ACTORS.HUMAN_RECOVERY
});

export function assertActorAuthorized(from,to,actor){
 const expected=TRANSITION_ACTOR[`${from}->${to}`];
 if(!expected) throw new Error("ILLEGAL_TRANSITION");
 if(actor!==expected) throw new Error(`ACTOR_NOT_AUTHORIZED:expected=${expected}:actual=${actor}`);
 return true;
}
