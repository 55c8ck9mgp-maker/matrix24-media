const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const page=()=>new Response("<!doctype html><title>MATRIX 24 staging authorization complete</title><p>Authorization complete. You may close this window.</p>",{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'"}});
const id=/^[0-9]+$/;
const diagnostic=error=>error?.name==="AbortError"?"abort":error?.name==="TimeoutError"?"timeout":error?.name==="TypeError"?"fetch":"unknown";
const configured=env=>env?.MATRIX24_MODE==="staging-reconciliation"&&typeof env.IG_READ_TOKEN==="string"&&env.IG_READ_TOKEN.length>=20&&typeof env.IG_ACCOUNT_ID==="string"&&id.test(env.IG_ACCOUNT_ID)&&typeof env.IG_USERNAME==="string"&&env.IG_USERNAME.length>0;
async function lookup(mediaId,accessToken,fetchImpl=fetch){
 if(!id.test(mediaId))return {kind:"invalid_request",reason:"invalid_media_id"};
 if(typeof accessToken!=="string"||accessToken.trim().length<20)return {kind:"invalid_request",reason:"missing_access_token"};
 let reply;try{reply=await fetchImpl(`https://graph.instagram.com/${mediaId}?fields=id,permalink,username`,{method:"GET",headers:{authorization:`Bearer ${accessToken}`,accept:"application/json"},redirect:"manual"})}catch(error){return {kind:"lookup_unavailable",reason:"network",diagnostic:diagnostic(error)}}
 if(reply.status>=300&&reply.status<400)return {kind:"lookup_unavailable",reason:`redirect_${reply.status}`};
 if(reply.status===401||reply.status===403)return {kind:"lookup_unavailable",reason:"authentication"};
 if(reply.status===404)return {kind:"lookup_not_found"};
 if(!reply.ok)return {kind:"lookup_unavailable",reason:`http_${reply.status}`};
 let body;try{body=await reply.json()}catch{return {kind:"lookup_unavailable",reason:"invalid_json"}}
 if(typeof body?.id!=="string"||!id.test(body.id)||body.id!==mediaId)return {kind:"lookup_unavailable",reason:"identity_mismatch"};
 return {kind:"ig_media",id:body.id,permalink:typeof body.permalink==="string"?body.permalink:null,username:typeof body.username==="string"?body.username:null};
}
async function handle(request,env,fetchImpl=fetch){
 const url=new URL(request.url);
 if(request.method==="GET"&&url.pathname==="/auth/instagram/callback")return page();
 if(request.method==="GET"&&url.pathname==="/health")return json({status:"ok",mode:env?.MATRIX24_MODE||"unconfigured",publication_allowed:false,claims_writable:false,cron_enabled:false});
 const match=request.method==="GET"&&url.pathname.match(/^\/lookup\/([0-9]+)$/);
 if(!match)return json({error:"not_found"},404);
 if(!configured(env))return json({error:"staging_not_configured"},503);
 const result=await lookup(match[1],env.IG_READ_TOKEN,fetchImpl);
 if(result.kind!=="ig_media")return json({status:"unverified",reason:result.reason||result.kind,diagnostic:result.diagnostic||null},result.kind==="lookup_not_found"?404:502);
 if(result.username!==env.IG_USERNAME)return json({status:"unknown",action:"lookup_identity_conflict",media_id:null,permalink:null,verification_source:null});
 return json({status:"confirmed",action:"direct_lookup_verified",media_id:result.id,permalink:result.permalink,verification_source:"direct_lookup"});
}
export default {fetch:handle};
