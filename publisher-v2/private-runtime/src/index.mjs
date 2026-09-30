import { WorkerEntrypoint } from 'cloudflare:workers';
import {mintInstallationToken,isSupportedGitHubAppPrivateKey} from './github-app-auth.mjs';

function blocked(code) { const error=new Error(code); error.code=code; throw error; }
export function assertPrivateStagingConfig(env={}) {
  if (env.MATRIX24_MODE!=='publisher-v2-staging') blocked('STAGING_MODE_REQUIRED');
  if (env.PUBLISHER_V2_ENABLED!=='false') blocked('PUBLISHER_MUST_START_DISABLED');
  if (!/^55c8ck9mgp-maker\/matrix24-publication-v2-staging$/.test(env.STAGING_REPOSITORY||'')) blocked('STAGING_REPOSITORY_REQUIRED');
  if (!/^[1-9][0-9]*$/.test(String(env.GITHUB_APP_ID)) || !/^[1-9][0-9]*$/.test(String(env.GITHUB_INSTALLATION_ID))) blocked('GITHUB_APP_BINDING_REQUIRED');
  if (!isSupportedGitHubAppPrivateKey(env.GITHUB_APP_PRIVATE_KEY)) blocked('GITHUB_APP_SECRET_REQUIRED');
  return true;
}
export async function preflightIdentity(env,dependencies={}) {
  assertPrivateStagingConfig(env);
  return mintInstallationToken({appId:env.GITHUB_APP_ID,privateKeyPem:env.GITHUB_APP_PRIVATE_KEY,installationId:env.GITHUB_INSTALLATION_ID,fetchImpl:dependencies.fetchImpl,cryptoImpl:dependencies.cryptoImpl,nowSeconds:dependencies.nowSeconds});
}
export class IdentityPreflight extends WorkerEntrypoint {
  async identityCheck() {
    const result=await preflightIdentity(this.env);
    const token=result.token;
    const repo=this.env.STAGING_REPOSITORY;
    const response=await fetch('https://api.github.com/repos/'+repo,{
      method:'GET',
      headers:{accept:'application/vnd.github+json',authorization:'Bearer '+token,'x-github-api-version':'2022-11-28','cache-control':'no-store'}
    });
    if(!response.ok) blocked('STAGING_REPOSITORY_READ_UNCONFIRMED');
    const body=await response.json();
    if(body?.full_name!==repo || body?.private!==true) blocked('STAGING_REPOSITORY_IDENTITY_MISMATCH');
    return {ok:true,repository:repo,private:true,expires_at:result.expiresAt};
  }
}

export default {
  async fetch() { return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}}); },
  async scheduled() { /* No cron is configured. Future activation requires a separate reviewed change. */ }
};
