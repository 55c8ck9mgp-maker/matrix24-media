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
     {message:'GITHUB_APP_JWT_UNCONFIRMED_HTTP_'+label+'_DIAGNOSTIC_REDACTED'}
   );
 });
 test('installation failure is classified only after JWT preflight succeeds for HTTP '+status,async()=>{
   let call=0;
   const fetchImpl=async()=>++call===1?{ok:true,status:200}:{ok:false,status};
   await assert.rejects(
     mintInstallationToken({appId:'5101330',installationId:'165591323',privateKeyPem:pem,fetchImpl,cryptoImpl:webcrypto,nowSeconds:1700000000}),
     {message:'GITHUB_INSTALLATION_TOKEN_UNCONFIRMED_HTTP_'+label+'_DIAGNOSTIC_REDACTED'}
   );
   assert.equal(call,2);
 });
}

test('JWT preflight emits only allowlisted GitHub diagnostics',async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({
   message:'Bad credentials',
   token:'must-not-appear',
   detail:'must-not-appear'
 }),{
   status:403,
   headers:{
     'x-github-request-id':'ABCD:1234',
     'x-ratelimit-remaining':'0',
     'x-ratelimit-resource':'core',
     'x-untrusted-header':'must-not-appear'
   }
 });
 await assert.rejects(
   mintInstallationToken({appId:'5101330',installationId:'165591323',privateKeyPem:pem,fetchImpl,cryptoImpl:webcrypto,nowSeconds:1700000000}),
   error=>{
     assert.equal(error.message,'GITHUB_APP_JWT_UNCONFIRMED_HTTP_403_DIAGNOSTIC_BAD_CREDENTIALS_REQUEST_ID_ABCD:1234_RATE_LIMIT_REMAINING_0_RATE_LIMIT_RESOURCE_core');
     assert.doesNotMatch(error.message,/must-not-appear|token|detail/i);
     return true;
   }
 );
});
