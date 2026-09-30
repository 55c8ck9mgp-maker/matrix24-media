export async function runIdentityCheck(env={}) {
  if (env.MATRIX24_MODE !== 'publisher-v2-identity-preflight') throw new Error('IDENTITY_PREFLIGHT_MODE_REQUIRED');
  if (!env.PUBLISHER_IDENTITY || typeof env.PUBLISHER_IDENTITY.identityCheck !== 'function') throw new Error('IDENTITY_SERVICE_BINDING_REQUIRED');
  const result=await env.PUBLISHER_IDENTITY.identityCheck();
  if (result?.ok !== true || result?.repository !== '55c8ck9mgp-maker/matrix24-publication-v2-staging' || result?.private !== true) throw new Error('IDENTITY_PREFLIGHT_UNCONFIRMED');
  return {ok:true,repository:result.repository,private:true};
}

export default {
  async fetch() { return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}}); },
  async scheduled() { /* Deliberately inert. No cron is configured. */ }
};
