function failure(code) { const error = new Error(code); error.code = code; return error; }
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const utf8 = value => new TextEncoder().encode(value);

function derLength(length) {
  if (length < 128) return Uint8Array.of(length);
  const bytes=[]; for(let n=length;n>0;n>>=8) bytes.unshift(n & 255);
  return Uint8Array.of(0x80 | bytes.length,...bytes);
}
function der(tag,...parts) {
  const size=parts.reduce((n,p)=>n+p.length,0), out=new Uint8Array(1+derLength(size).length+size);
  out[0]=tag; const len=derLength(size); out.set(len,1); let offset=1+len.length;
  for(const part of parts){out.set(part,offset);offset+=part.length;} return out;
}
function wrapPkcs1AsPkcs8(pkcs1) {
  const version=Uint8Array.of(0x02,0x01,0x00);
  const rsaAlgorithm=Uint8Array.of(0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00);
  return der(0x30,version,rsaAlgorithm,der(0x04,pkcs1));
}
function decodePem(pem) {
  if (typeof pem !== 'string') throw failure('GITHUB_APP_KEY_INVALID');
  const normalized=pem.trim().replace(/\\n/g,'\n');
  const match=normalized.match(/-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY)-----([\s\S]*?)-----END \1-----/);
  if (!match) throw failure('GITHUB_APP_KEY_INVALID');
  const body=match[2].replace(/\s/g,'');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw failure('GITHUB_APP_KEY_INVALID');
  let bytes; try { bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0)); } catch { throw failure('GITHUB_APP_KEY_INVALID'); }
  return match[1] === 'RSA PRIVATE KEY' ? wrapPkcs1AsPkcs8(bytes) : bytes;
}
export function isSupportedGitHubAppPrivateKey(pem) { try { decodePem(pem); return true; } catch { return false; } }
export async function createGitHubAppJwt({appId,privateKeyPem,nowSeconds=Math.floor(Date.now()/1000),cryptoImpl=crypto}={}) {
  if (!/^[1-9][0-9]*$/.test(String(appId))) throw failure('GITHUB_APP_ID_INVALID');
  if (!Number.isInteger(nowSeconds)) throw failure('GITHUB_APP_CLOCK_INVALID');
  const header=b64url(utf8(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload=b64url(utf8(JSON.stringify({iat:nowSeconds-60,exp:nowSeconds+540,iss:String(appId)})));
  let key; try { key=await cryptoImpl.subtle.importKey('pkcs8',decodePem(privateKeyPem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']); }
  catch { throw failure('GITHUB_APP_KEY_INVALID'); }
  const signature=new Uint8Array(await cryptoImpl.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8(header+'.'+payload)));
  return header+'.'+payload+'.'+b64url(signature);
}
export async function mintInstallationToken({appId,privateKeyPem,installationId,fetchImpl=fetch,cryptoImpl=crypto,nowSeconds}={}) {
  if (!/^[1-9][0-9]*$/.test(String(installationId)) || typeof fetchImpl!=='function') throw failure('GITHUB_INSTALLATION_INVALID');
  const jwt=await createGitHubAppJwt({appId,privateKeyPem,nowSeconds,cryptoImpl});
  const response=await fetchImpl('https://api.github.com/app/installations/'+installationId+'/access_tokens',{method:'POST',headers:{accept:'application/vnd.github+json',authorization:'Bearer '+jwt,'x-github-api-version':'2022-11-28'}});
  if (!response.ok) { const status=[401,403,404,422].includes(response.status)?response.status:'OTHER'; throw failure('GITHUB_INSTALLATION_TOKEN_UNCONFIRMED_HTTP_'+status); }
  const body=await response.json();
  if (typeof body?.token!=='string' || body.token.length<20 || typeof body.expires_at!=='string') throw failure('GITHUB_INSTALLATION_TOKEN_INVALID');
  return {token:body.token,expiresAt:body.expires_at};
}
