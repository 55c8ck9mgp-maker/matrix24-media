import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { mintInstallationToken } from '../publisher-v2/private-runtime/src/github-app-auth.mjs';

const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();

for (const status of [401,403,404,422,500]) {
 const label=[401,403,404,422].includes(status)?status:'OTHER';
 test('JWT preflight failure classifies HTTP '+status+' without response body',async()=>{
   const fetchImpl=async()=>({ok:false,status});
   await assert.rejects(
     mintInstallationToken({appId:'5101330',installationId:'165591323',privateKeyPem:pem,fetchImpl,cryptoImpl:webcrypto,nowSeconds:1700000000}),
     {message:'GITHUB_APP_JWT_UNCONFIRMED_HTTP_'+label}
   );
 });
 test('installation failure is classified only after JWT preflight succeeds for HTTP '+status,async()=>{
   let call=0;
   const fetchImpl=async()=>++call===1?{ok:true,status:200}:{ok:false,status};
   await assert.rejects(
     mintInstallationToken({appId:'5101330',installationId:'165591323',privateKeyPem:pem,fetchImpl,cryptoImpl:webcrypto,nowSeconds:1700000000}),
     {message:'GITHUB_INSTALLATION_TOKEN_UNCONFIRMED_HTTP_'+label}
   );
   assert.equal(call,2);
 });
}
