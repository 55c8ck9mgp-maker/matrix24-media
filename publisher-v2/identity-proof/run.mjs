import { getPlatformProxy } from 'wrangler';
import { proveIdentity } from './src/index.mjs';

const proxy = await getPlatformProxy({
  configPath: 'publisher-v2/identity-proof/wrangler.jsonc',
  remoteBindings: true
});

try {
  const result = await proveIdentity(proxy.env);
  console.log('IDENTITY_PROOF_OK', JSON.stringify(result));
} finally {
  await proxy.dispose();
}
