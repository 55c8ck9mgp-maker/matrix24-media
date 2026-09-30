import runtime, { verifyStagingIdentity } from './index.mjs';
import { WorkerEntrypoint } from 'cloudflare:workers';

export class IdentityPreflight extends WorkerEntrypoint {
  async identityCheck() {
    return verifyStagingIdentity(this.env);
  }
}

export default runtime;
