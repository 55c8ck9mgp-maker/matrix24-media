export async function proveIdentity(env = {}) {
  if (!env.IDENTITY_GATE || typeof env.IDENTITY_GATE.run !== 'function') {
    throw new Error('IDENTITY_GATE_REQUIRED');
  }
  const result = await env.IDENTITY_GATE.run();
  if (
    result?.ok !== true ||
    result?.repository !== '55c8ck9mgp-maker/matrix24-publication-v2-staging' ||
    result?.private !== true
  ) {
    throw new Error('IDENTITY_PROOF_UNCONFIRMED');
  }
  return { ok: true, repository: result.repository, private: true };
}
