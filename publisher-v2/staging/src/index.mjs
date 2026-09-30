import {runPublicationCycle} from './engine.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

function fixtureAdapter(outcome = {}) {
  return {
    async reserve(plan) { return outcome.reserve || {kind:'reserved',record:plan.replacement}; },
    async persistPreSend({record}) { return outcome.persistPreSend || {kind:'pre_send_persisted',record}; },
    async send() { return outcome.send || {kind:'ambiguous'}; },
    async archive() { return outcome.archive || {kind:'archive_failed'}; },
    async markUnknown() { return outcome.markUnknown || {kind:'marked_unknown'}; },
    async returnReady() { return outcome.returnReady || {kind:'returned_ready'}; },
    async reconcile() { return outcome.reconcile || {kind:'reconciled'}; }
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({status:'ok',service:'matrix24-publication-v2-staging',mode:env.MATRIX24_MODE || 'publisher-v2-fixtures-only',external_side_effects:false,cron_enabled:false});
    }
    if (request.method !== 'POST' || url.pathname !== '/fixture/cycle') return json({error:'Not found'},404);
    try {
      const payload = await request.json();
      const result = await runPublicationCycle({...payload,adapter:fixtureAdapter(payload.outcome)});
      return json({success:true,result});
    } catch {
      return json({success:false,error:'STAGING_FIXTURE_FAILED'},400);
    }
  }
};
