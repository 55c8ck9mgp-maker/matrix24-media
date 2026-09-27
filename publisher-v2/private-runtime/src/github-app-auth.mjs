function failure(code) { const error = new Error(code); error.code = code; return error; }
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const utf8 = value => new TextEncoder().encode(value);
function pemBytes(pem) {
  if (typeof pem !== 'string') throw failure('GITHUB_APP_KEY_INVALID');
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  try { return Uint8Array.from(atob(body),character => character.charCodeAt(0)); } catch { throw failure('GITHUB_APP_KEY_INVALID'); }
}
export async function createGitHubAppJwt({appId,privateKeyPem,nowSeconds=Math.floor(Date.now()/1000),cryptoImpl=crypto}={}) {
  if (!/^[1-9][0-9]*$/.test(String(appId))) throw failure('GITHUB_APP_ID_INVALID');
  if (!Number.isInteger(nowSeconds)) throw failure('GITHUB_APP_CLOCK_INVALID');
  const header=b64url(utf8(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload=b64url(utf8(JSON.stringify({iat:nowSeconds-60,exp:nowSeconds+540,iss:String(appId)})));
  let key;
  try { key=await cryptoImpl.subtle.importKey('pkcs8',pemBytes(privateKeyPem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']); }
  catch { throw failure('GITHUB_APP_KEY_INVALID'); }
  const signature=new Uint8Array(await cryptoImpl.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8(header+'.'+payload)));
  return header+'.'+payload+'.'+b64url(signature);
}
export async function mintInstallationToken({appId,privateKeyPem,installationId,fetchImpl=fetch,cryptoImpl=crypto,nowSeconds}={}) {
  if (!/^[1-9][0-9]*$/.test(String(installationId)) || typeof fetchImpl!=='function') throw failure('GITHUB_INSTALLATION_INVALID');
  const jwt=await createGitHubAppJwt({appId,privateKeyPem,nowSeconds,cryptoImpl});
  const response=await fetchImpl('https://api.github.com/app/installations/'+installationId+'/access_tokens',{method:'POST',headers:{accept:'application/vnd.github+json',authorization:'Bearer '+jwt,'x-github-api-version':'2022-11-28'}});
  if (!response.ok) throw failure('GITHUB_INSTALLATION_TOKEN_UNCONFIRMED');
  const body=await response.json();
  if (typeof body?.token!=='string' || body.token.length<20 || typeof body.expires_at!=='string') throw failure('GITHUB_INSTALLATION_TOKEN_INVALID');
  return {token:body.token,expiresAt:body.expires_at};
}
