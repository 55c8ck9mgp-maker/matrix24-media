import runtime, { runIdentityCheck } from './index.mjs';
import { WorkerEntrypoint } from 'cloudflare:workers';

export class IdentityGate extends WorkerEntrypoint {
  async run() {
    return runIdentityCheck(this.env);
  }
}

export default runtime;
