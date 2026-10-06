#!/usr/bin/env node
// Claude Lane token renewal (docs/CLAUDE_LANE.md rule 8). Refreshes the
// long-lived Instagram token, which extends its life by ~60 days. The token is
// never printed: only a hash comparison and the remaining lifetime are reported.
// GITHUB_TOKEN cannot write repository secrets, so if Instagram ever returns a
// different token string the job fails loudly and Justen updates the secret.
import crypto from 'node:crypto';

export const MIN_DAYS = 20;
const h = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

export function assess(current, body) {
  if (!body || typeof body.access_token !== 'string') return { outcome: 'refresh_failed', error: body?.error?.message ?? 'no token' };
  const days = Math.floor(Number(body.expires_in) / 86400);
  if (body.access_token !== current) return { outcome: 'token_changed_update_secret', days, new_hash: h(body.access_token) };
  if (!Number.isFinite(days) || days < MIN_DAYS) return { outcome: 'expiring_soon', days };
  return { outcome: 'refreshed', days };
}

async function main() {
  const token = process.env.IG_CLAUDE_ACCESS_TOKEN;
  if (!token) { console.log(JSON.stringify({ outcome: 'secret_missing' })); process.exit(1); }
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  let body = null;
  try { body = await (await fetch(url)).json(); } catch { body = null; }
  const r = assess(token, body);
  console.log(JSON.stringify(r));
  console.log(`::${r.outcome === 'refreshed' ? 'notice' : 'error'} title=IG token::${JSON.stringify(r)}`);
  process.exit(r.outcome === 'refreshed' ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
