import { WorkerEntrypoint } from 'cloudflare:workers';
import { verifyStagingIdentity } from './index.mjs';

export class IdentityPreflight extends WorkerEntrypoint {
  async identityCheck() {
    return verifyStagingIdentity(this.env);
  }
}
