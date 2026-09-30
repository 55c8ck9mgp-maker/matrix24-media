import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { mintInstallationToken } from '../publisher-v2/private-runtime/src/github-app-auth.mjs';

const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();

for (const status of [401,403,404,422,500]) {
 test('installation token failure classifies HTTP '+status+' without response body',async()=>{
   const fetchImpl=async()=>({ok:false,status});
   await assert.rejects(
     mintInstallationToken({appId:'5101330',installationId:'165591323',privateKeyPem:pem,fetchImpl,cryptoImpl:webcrypto,nowSeconds:1700000000}),
     {message:'GITHUB_INSTALLATION_TOKEN_UNCONFIRMED_HTTP_'+([401,403,404,422].includes(status)?status:'OTHER')}
   );
 });
}
