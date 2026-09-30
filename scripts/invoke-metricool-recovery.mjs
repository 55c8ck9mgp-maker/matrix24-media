// Deprecated Metricool recovery gate.
//
// This module is intentionally fail-closed. A stalled publishing claim is
// ambiguous external-write evidence and MUST be reconciled against the existing
// attempt. It never calls Metricool, never writes queue state, and never retries
// publication.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

class RecoveryError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

function readPlan(planFile) {
  try {
    return JSON.parse(fs.readFileSync(planFile, 'utf8'));
  } catch (error) {
    throw new RecoveryError('PLAN_READ_FAILED', error.message);
  }
}

function isDryRun() {
  return ['true', '1', 'yes'].includes(process.env.DRY_RUN);
}

async function invokeMetricoolRecovery(planFile) {
  const plan = readPlan(planFile);
  const stalled = Array.isArray(plan.stalled) ? plan.stalled : [];
  const results = {
    dry_run: isDryRun(),
    recovered: [],
    conflicts: [],
    errors: [],
    blocked: stalled.map(record => ({
      content_id: record.content_id,
      queue_path: record.filename ? `queue/${record.filename}` : null,
      reason: 'reconciliation_required',
      detail: 'Fail-closed: no external retry without authoritative reconciliation and durable action_not_invoked evidence.'
    })),
    total: stalled.length
  };

  if (stalled.length === 0) console.log('No stalled records to reconcile.');
  else console.log(`Blocked ${stalled.length} stalled publication(s): reconciliation required; no Metricool write invoked.`);
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const planFile = process.argv[2];
  if (!planFile) {
    console.error('Usage: node invoke-metricool-recovery.mjs <plan.json>');
    process.exitCode = 1;
  } else {
    try {
      const results = await invokeMetricoolRecovery(planFile);
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } catch (error) {
      console.error(`Fatal error: ${error.message}`);
      process.stdout.write(`${JSON.stringify({ ok:false, code:error.code || 'UNEXPECTED', error:String(error.message || error) }, null, 2)}\n`);
      process.exitCode = 1;
    }
  }
}

export { invokeMetricoolRecovery };
