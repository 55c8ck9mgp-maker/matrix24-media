export async function runPreflight(env={}) {
  if (env.PUBLISHER_V2_ENABLED !== 'false') throw new Error('SCHEDULER_MUST_START_DISABLED');
  if (env.STAGING_REPOSITORY !== '55c8ck9mgp-maker/matrix24-publication-v2-staging') throw new Error('STAGING_REPOSITORY_REQUIRED');
  if (!env.IDENTITY_GATE || typeof env.IDENTITY_GATE.run !== 'function') throw new Error('IDENTITY_GATE_REQUIRED');
  const result=await env.IDENTITY_GATE.run();
  if (result?.ok !== true || result?.repository !== env.STAGING_REPOSITORY || result?.private !== true) throw new Error('IDENTITY_GATE_UNCONFIRMED');
  return {ok:true,identity:'confirmed',repository:env.STAGING_REPOSITORY};
}

export default {
  async fetch() { return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}}); },
  async scheduled() { /* No cron until separately reviewed activation. */ }
};
