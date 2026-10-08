#!/usr/bin/env node
// Entry point for .github/workflows/claude-lane-discard.yml (owner-only, manual).
// Writes only when DISCARD_APPLY is exactly "true"; otherwise it is a dry run.
import { createInstagramClient } from '../instagram-graph.mjs';
import { createGitStore } from './git-store.mjs';
import { fsReadOnlyStore } from './run-publisher.mjs';
import { discardUnknown } from './discard.mjs';

const live = process.env.DISCARD_APPLY === 'true';
const ig = createInstagramClient({ accessToken: process.env.IG_CLAUDE_ACCESS_TOKEN, igUserId: process.env.IG_CLAUDE_USER_ID });
const result = await discardUnknown({
  store: live ? createGitStore() : fsReadOnlyStore(),
  ig,
  contentId: process.env.DISCARD_CONTENT_ID,
  confirm: process.env.DISCARD_CONFIRM,
  decidedBy: process.env.DISCARD_DECIDED_BY,
  reason: process.env.DISCARD_REASON,
  live,
});
const line = JSON.stringify({ stage: 'discard', live, ...result });
console.log(line);
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=lane discard::${line.slice(0, 900)}`);
if (!['discarded', 'would_discard'].includes(result.outcome)) process.exit(1);
