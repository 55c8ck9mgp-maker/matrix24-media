// Claude Lane blocked-alert (docs/CLAUDE_LANE.md "Recovery").
// Read-only detector: finds lane records that block the whole lane
// (publish_unknown, or publishing left behind) and reports them. It never
// changes a record, never retries, never discards and never calls Instagram.
// Its only side effect is opening (or leaving open) one GitHub issue, so the
// owner is notified with the exact recovery steps.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const BLOCKING_STATUSES = Object.freeze(['publish_unknown', 'publishing']);
export const STALE_PUBLISHING_MS = 30 * 60 * 1000;
export const ALERT_LABEL = 'claude-lane-blocked';

// records: [{ content_id, status, reserved_at, publish_attempt_id, history }]
export function findBlockers(records, nowMs) {
  const out = [];
  for (const r of records) {
    if (!r || !BLOCKING_STATUSES.includes(r.status)) continue;
    const reserved = Date.parse(r.reserved_at || '') || null;
    if (r.status === 'publishing' && (reserved === null || nowMs - reserved < STALE_PUBLISHING_MS)) continue;
    const last = [...(r.history || [])].reverse().find(h => h && h.reason) || {};
    out.push({
      content_id: r.content_id,
      status: r.status,
      since: r.reserved_at || null,
      reason: last.reason || null,
      attempt: r.publish_attempt_id || null,
    });
  }
  return out;
}

export function readQueueRecords(dir) {
  const records = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try { records.push(JSON.parse(readFileSync(join(dir, name), 'utf8'))); }
    catch { records.push({ content_id: name, status: 'unreadable' }); }
  }
  return records;
}

export function issueTitle(blockers) {
  const ids = blockers.map(b => b.content_id).join(', ');
  return `Claude Lane bloqueado: ${ids}`.slice(0, 250);
}

export function issueBody(blockers, nowIso) {
  const lines = [
    `Detectado ${nowIso} (UTC). El carril de Claude no publica nada mientras estos registros estén bloqueando.`,
    '',
    '| content_id | estado | desde (UTC) | motivo |',
    '|---|---|---|---|',
    ...blockers.map(b => `| ${b.content_id} | ${b.status} | ${b.since || '—'} | ${b.reason || '—'} |`),
    '',
    '## Qué hacer (dueño)',
    '1. Revisa en @matrix24global si la historia ya aparece en el feed.',
    '2. Si **no aparece**: Actions → *Claude Lane discard (owner only)* → Run workflow con `content_id`, el mismo id en `confirm_content_id` y un `reason`. Primero sin `apply` (dry run), luego con `apply` activado.',
    '3. Si **sí aparece**: el reconciliador lo marcará como publicado en el siguiente ciclo. Si no lo hace, avisa aquí.',
    '',
    'Este aviso no publica, no reintenta y no descarta nada. Se cierra solo cuando ya no hay registros bloqueados.',
  ];
  return lines.join('\n');
}
