import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,webcrypto,verify} from 'node:crypto';
import worker,{assertPrivateStagingConfig,preflightIdentity} from '../publisher-v2/private-runtime/src/index.mjs';
import {createGitHubAppJwt} from '../publisher-v2/private-runtime/src/github-app-auth.mjs';

const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=pair.privateKey.export({type:'pkcs8',format:'pem'});
const pkcs1Pem=pair.privateKey.export({type:'pkcs1',format:'pem'});
const env={MATRIX24_MODE:'publisher-v2-staging',PUBLISHER_V2_ENABLED:'false',STAGING_REPOSITORY:'55c8ck9mgp-maker/matrix24-publication-v2-staging',GITHUB_APP_ID:'5101330',GITHUB_INSTALLATION_ID:'165591323',GITHUB_APP_PRIVATE_KEY:pem};
const decode=value=>JSON.parse(Buffer.from(value.replace(/-/g,'+').replace(/_/g,'/'),'base64url').toString());
test('GitHub App JWT is short-lived and RSA-signed',async()=>{
 const jwt=await createGitHubAppJwt({appId:env.GITHUB_APP_ID,privateKeyPem:pem,nowSeconds:1000,cryptoImpl:webcrypto});
 const [header,payload,signature]=jwt.split('.');assert.deepEqual(decode(header),{alg:'RS256',typ:'JWT'});assert.deepEqual(decode(payload),{iat:940,exp:1540,iss:'5101330'});
 assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+payload),pair.publicKey,Buffer.from(signature.replace(/-/g,'+').replace(/_/g,'/'),'base64url')),true);
});
test('GitHub App JWT accepts GitHub RSA PEM and escaped-newline secret serialization',async()=>{
 for (const privateKeyPem of [pkcs1Pem, String(pkcs1Pem).replace(/\n/g,'\\n')]) {
  const jwt=await createGitHubAppJwt({appId:env.GITHUB_APP_ID,privateKeyPem,nowSeconds:1000,cryptoImpl:webcrypto});
  const [header,payload,signature]=jwt.split('.');
  assert.deepEqual(decode(payload),{iat:940,exp:1540,iss:'5101330'});
  assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+payload),pair.publicKey,Buffer.from(signature.replace(/-/g,'+').replace(/_/g,'/'),'base64url')),true);
 }
});
test('private runtime accepts supported key envelopes but refuses malformed secrets',()=>{
 assert.equal(assertPrivateStagingConfig({...env,GITHUB_APP_PRIVATE_KEY:pkcs1Pem}),true);
 assert.equal(assertPrivateStagingConfig({...env,GITHUB_APP_PRIVATE_KEY:String(pkcs1Pem).replace(/\n/g,'\\n')}),true);
 assert.throws(()=>assertPrivateStagingConfig({...env,GITHUB_APP_PRIVATE_KEY:'-----BEGIN RSA PRIVATE KEY-----\\nnot-base64\\n-----END RSA PRIVATE KEY-----'}));
});
test('private runtime refuses public fetch and stays disabled until a separate activation',async()=>{
 assert.equal(assertPrivateStagingConfig(env),true);assert.equal((await worker.fetch()).status,404);
 for(const changed of [{PUBLISHER_V2_ENABLED:'true'},{STAGING_REPOSITORY:'55c8ck9mgp-maker/matrix24-media'},{GITHUB_APP_PRIVATE_KEY:'bad'}]) assert.throws(()=>assertPrivateStagingConfig({...env,...changed}));
});
test('installation token is minted only after private staging preflight',async()=>{
 const calls=[];const result=await preflightIdentity(env,{cryptoImpl:webcrypto,nowSeconds:1000,fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({token:'x'.repeat(30),expires_at:'2026-09-28T00:00:00Z'}),{status:201});}});
 assert.equal(result.expiresAt,'2026-09-28T00:00:00Z');assert.equal(calls.length,1);assert.match(calls[0].url,/installations\/165591323\/access_tokens$/);assert.match(calls[0].init.headers.authorization,/^Bearer /);assert.equal(result.token,'x'.repeat(30));assert.equal(calls[0].init.headers.authorization.includes('x'.repeat(30)),false);
});
