import { WorkerEntrypoint } from 'cloudflare:workers';
import { runIdentityCheck } from './index.mjs';

export class IdentityGate extends WorkerEntrypoint {
  async run() {
    return runIdentityCheck(this.env);
  }
}
