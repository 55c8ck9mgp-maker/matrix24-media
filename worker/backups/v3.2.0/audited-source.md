*// @ts-nocheck*



const REPO = "55c8ck9mgp-maker/matrix24-media";

const QUEUE\_PATH = "queue";

const GITHUB\_API = \`https\://api.github.com/repos/${REPO}\`;

const VERSION = "3.2.0";

const MAX\_JPEG\_BYTES = 8 \* 1024 \* 1024;

const IMAGE\_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning";





class SafeError extends Error {

&#x20; constructor(code, status = 500) { *super*(code); *this*.code = code; *this*.status = status; }

}



async function sha256(value) {

&#x20; return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');

}



async function authorized(request, env) {

&#x20; const secret = env.MATRIX24\_API\_TOKEN;

&#x20; if (typeof secret !== 'string' || secret.length < 32) return false;

&#x20; const supplied = request.headers.get('authorization') || '';

&#x20; if (!supplied.startsWith('Bearer ') || supplied.length > 512) return false;

&#x20; const a = await sha256(supplied.slice(7));

&#x20; const b = await sha256(secret);

&#x20; let difference = 0;

&#x20; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);

&#x20; return difference === 0;

}



function storageBase(env) {

&#x20; const u = new URL(env.SUPABASE\_URL);

&#x20; if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.endsWith('.supabase.co')) throw new SafeError('STORAGE\_CONFIG\_INVALID');

&#x20; if (!/^[a-zA-Z0-9\_-]+$/.test(env.SUPABASE\_BUCKET || '')) throw new SafeError('STORAGE\_CONFIG\_INVALID');

&#x20; return u.origin;

}



function checkedImageUrl(value, env) {

&#x20; let u;

&#x20; try { u = new URL(value); } catch { throw new SafeError('IMAGE\_URL\_NOT\_ALLOWED', 400); }

&#x20; const prefix = \`/storage/v1/object/public/${env.SUPABASE\_BUCKET}/\`;

&#x20; if (u.origin !== storageBase(env) || u.username || u.password || u.search || u.hash || !u.pathname.startsWith(prefix) || u.pathname.length <= prefix.length) throw new SafeError('IMAGE\_URL\_NOT\_ALLOWED', 400);

&#x20; return u.href;

}



async function boundedBytes(response, limit = MAX\_JPEG\_BYTES) {

&#x20; const declared = Number(response.headers.get('content-length'));

&#x20; if (declared > limit) { await response.body?.cancel(); throw new SafeError('IMAGE\_TOO\_LARGE', 413); }

&#x20; if (!response.body) throw new SafeError('EMPTY\_IMAGE', 400);

&#x20; const reader = response.body.getReader();

&#x20; const parts = []; let size = 0; let timer;

&#x20; const timeout = new Promise((\_, reject) => { timer = setTimeout(() => { reject(new SafeError('IMAGE\_READ\_TIMEOUT', 408)); void reader.cancel(); }, 15000); });

&#x20; try {

&#x20;   while (true) {

&#x20;     const {done, value} = await Promise.race([reader.read(), timeout]);

&#x20;     if (done) break;

&#x20;     size += value.byteLength;

&#x20;     if (size > limit) throw new SafeError('IMAGE\_TOO\_LARGE', 413);

&#x20;     parts.push(value);

&#x20;   }

&#x20;   if (!size) throw new SafeError('EMPTY\_IMAGE', 400);

&#x20;   const bytes = new Uint8Array(size); let offset = 0;

&#x20;   for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }

&#x20;   return bytes;

&#x20; } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }

}



async function existingJpeg(url) {

&#x20; const response = await fetch(url, {method:'HEAD', redirect:'error', signal:AbortSignal.timeout(15000)});

&#x20; if (response.status === 404) return false;

*// Supabase can wrap NoSuchKey in HTTP 400; HEAD hides that JSON body.*

&#x20; if (response.status === 400) {

&#x20;   const detail = await fetch(url, {method:'GET', redirect:'error', signal:AbortSignal.timeout(15000)});

&#x20;   if (detail.status === 400 && (detail.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {

&#x20;     const error = JSON.parse(new TextDecoder().decode(await boundedBytes(detail, 4096)));

&#x20;     if (String(error.statusCode) === '404' && error.code === 'NoSuchKey') return false;

&#x20;   } else {

&#x20;     await detail.body?.cancel();

&#x20;   }

&#x20;   throw new SafeError('MEDIA\_RECONCILIATION\_REQUIRED');

&#x20; }

&#x20; if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/jpeg')) throw new SafeError('MEDIA\_RECONCILIATION\_REQUIRED');

&#x20; return true;

}



*/\*\**

*&#x20;\* @typedef {{*

*&#x20;\* timestamp?: string,*

*&#x20;\* content\_id?: string,*

*&#x20;\* status?: string,*

*&#x20;\* headline?: string,*

*&#x20;\* category?: string,*

*&#x20;\* verified\_source\_urls?: string[],*

*&#x20;\* caption?: string,*

*&#x20;\* hashtags?: string[],*

*&#x20;\* image\_filename?: string,*

*&#x20;\* image\_generation\_prompt?: string,*

*&#x20;\* public\_image\_url?: string|null,*

*&#x20;\* instagram\_media\_id?: string|null,*

*&#x20;\* instagram\_permalink?: string|null,*

*&#x20;\* publish\_attempt\_history?: any[],*

*&#x20;\* priority?: string,*

*&#x20;\* breaking?: boolean,*

*&#x20;\* media\_ready\_at?: string,*

*&#x20;\* image\_spec?: any,*

*&#x20;\* [key:string]&#58; any*

*&#x20;\* }} Story*

*&#x20;\*/*



*/\*\**

*&#x20;\* @typedef {{*

*&#x20;\* item: any,*

*&#x20;\* sha: string|null,*

*&#x20;\* path: string,*

*&#x20;\* story: Story|null,*

*&#x20;\* error: string|null*

*&#x20;\* }} QueueRecord*

*&#x20;\*/*



*/\*\* @param {any} data @param {number} [status] \*/*

function json(data, status = 200) {

&#x20; return new Response(JSON.stringify(data, null, 2), {

&#x20;   status,

&#x20;   headers: {

&#x20;     "content-type": "application/json; charset=utf-8",

&#x20;     "cache-control": "no-store",

&#x20;   },

&#x20; });

}



*/\*\* @param {any} env \*/*

function githubHeaders(env) {

&#x20; return {

&#x20;   Authorization: \`Bearer ${env.GITHUB\_TOKEN}\`,

&#x20;   Accept: "application/vnd.github+json",

&#x20;   "User-Agent": "matrix24-publisher",

&#x20;   "X-GitHub-Api-Version": "2022-11-28",

&#x20; };

}



*/\*\* @param {unknown} error \*/*

function errorMessage(error) {

&#x20; return error instanceof Error

&#x20;   ? error.message

&#x20;   : String(error || "Unknown error");

}



*/\*\* @param {unknown} value \*/*

function escapeHtml(value = "") {

&#x20; return String(value)

&#x20;   .replaceAll("&", "&amp;")

&#x20;   .replaceAll("<", "&lt;")

&#x20;   .replaceAll(">", "&gt;")

&#x20;   .replaceAll('"', "&quot;")

&#x20;   .replaceAll("'", "&#039;");

}



*/\*\* @param {Uint8Array} bytes \*/*

function bytesToBase64(bytes) {

&#x20; let binary = "";

&#x20; const chunkSize = 0x8000;



&#x20; for (let i = 0; i < bytes.length; i += chunkSize) {

&#x20;   binary += String.fromCharCode(

&#x20;     ...bytes.subarray(i, i + chunkSize)

&#x20;   );

&#x20; }



&#x20; return btoa(binary);

}



*/\*\* @param {string} value \*/*

function utf8ToBase64(value) {

&#x20; return bytesToBase64(

&#x20;   new TextEncoder().encode(value)

&#x20; );

}



*/\*\* @param {string} value \*/*

function base64ToUtf8(value) {

&#x20; const clean = String(value || "")

&#x20;   .replace(/\s/g, "");



&#x20; const binary = atob(clean);



&#x20; const bytes = Uint8Array.from(

&#x20;   binary,

&#x20;   (char) => char.charCodeAt(0)

&#x20; );



&#x20; return new TextDecoder("utf-8").decode(bytes);

}



*/\*\* @param {Uint8Array} bytes \*/*

function detectImageMime(bytes) {

&#x20; if (

&#x20;   bytes.length >= 3 &&

&#x20;   bytes[0] === 0xff &&

&#x20;   bytes[1] === 0xd8 &&

&#x20;   bytes[2] === 0xff

&#x20; ) {

&#x20;   return "image/jpeg";

&#x20; }



&#x20; if (

&#x20;   bytes.length >= 8 &&

&#x20;   bytes[0] === 0x89 &&

&#x20;   bytes[1] === 0x50 &&

&#x20;   bytes[2] === 0x4e &&

&#x20;   bytes[3] === 0x47

&#x20; ) {

&#x20;   return "image/png";

&#x20; }



&#x20; return "application/octet-stream";

}



*/\*\* @param {Uint8Array} bytes \*/*

function isJpeg(bytes) {

&#x20; return detectImageMime(bytes) === "image/jpeg";

}



*/\*\* @param {unknown} value \*/*

function safeFilename(value) {

&#x20; return (

&#x20;   String(value || "matrix24")

&#x20;     .toLowerCase()

&#x20;     .replace(/[^a-z0-9-\_]+/g, "-")

&#x20;     .replace(/^-+|-+$/g, "")

&#x20;     .slice(0, 120) ||

&#x20;   "matrix24"

&#x20; );

}



*/\*\* @param {string[]} urls \*/*

function sourceLabelFromUrls(urls = []) {

*/\*\* @type {string[]} \*/*

&#x20; const labels = [];



&#x20; for (const sourceUrl of urls) {

&#x20;   try {

&#x20;     const host =

&#x20;       new URL(sourceUrl).hostname.toLowerCase();



&#x20;     let label;



&#x20;     if (host.includes("reuters.com")) {

&#x20;       label = "Reuters";

&#x20;     } else if (host.includes("apnews.com")) {

&#x20;       label = "AP";

&#x20;     } else if (host.includes("bbc.")) {

&#x20;       label = "BBC";

&#x20;     } else if (host.includes("un.org")) {

&#x20;       label = "UN";

&#x20;     } else if (host.includes("noaa.gov")) {

&#x20;       label = "NOAA";

&#x20;     } else if (host.includes("nasa.gov")) {

&#x20;       label = "NASA";

&#x20;     } else {

&#x20;       label = host.replace(/^www\\./, "");

&#x20;     }



&#x20;     if (!labels.includes(label)) {

&#x20;       labels.push(label);

&#x20;     }

&#x20;   } catch {

*// Ignore malformed source URLs.*

&#x20;   }

&#x20; }



&#x20; return labels.length

&#x20;   ? labels.join(" / ")

&#x20;   : "Verified sources";

}



*/\*\* @param {unknown} headline \*/*

function headlineFontSize(headline) {

&#x20; const length =

&#x20;   String(headline || "").length;



&#x20; if (length > 115) return 50;

&#x20; if (length > 95) return 56;

&#x20; if (length > 75) return 62;

&#x20; if (length > 55) return 68;



&#x20; return 76;

}



function nowIso() {

&#x20; return new Date().toISOString();

}



*/\*\* @param {Story} story @param {any} attempt \*/*

function appendAttempt(story, attempt) {

&#x20; const history =

&#x20;   Array.isArray(story.publish\_attempt\_history)

&#x20;     ? story.publish\_attempt\_history

&#x20;     : [];



&#x20; history.push({

&#x20;   timestamp: nowIso(),

&#x20;   ...attempt,

&#x20; });



&#x20; story.publish\_attempt\_history =

&#x20;   history.slice(-50);

}



*/\*\**

*&#x20;\* @param {string} url*

*&#x20;\* @param {any} env*

*&#x20;\* @param {RequestInit} [options]*

*&#x20;\*/*

async function githubJson(

&#x20; url,

&#x20; env,

&#x20; options = {}

) {

&#x20; const response = await fetch(url, {

&#x20;   ...options,

&#x20;   redirect: "error",

&#x20;   signal: AbortSignal.timeout(15000),

&#x20;   headers: {

&#x20;     ...githubHeaders(env),

&#x20;     ...(options.headers || {}),

&#x20;   },

&#x20; });



&#x20; const text = await response.text();



*/\*\* @type {any} \*/*

&#x20; let body = null;



&#x20; if (text) {

&#x20;   try {

&#x20;     body = JSON.parse(text);

&#x20;   } catch {

&#x20;     body = text;

&#x20;   }

&#x20; }



&#x20; if (!response.ok) {

&#x20;   const message =

&#x20;     typeof body === "string"

&#x20;       ? body

&#x20;       : JSON.stringify(body || {});



&#x20;   throw new Error(

&#x20;     \`GITHUB\_REQUEST\_FAILED\_${response.status}\`

&#x20;   );

&#x20; }



&#x20; return body;

}



*/\*\* @param {any} env \*/*

async function listQueueFiles(env) {

&#x20; const items = await githubJson(

&#x20;   \`${GITHUB\_API}/contents/${QUEUE\_PATH}\`,

&#x20;   env

&#x20; );



&#x20; if (!Array.isArray(items)) {

&#x20;   return [];

&#x20; }



&#x20; return items.filter(

&#x20;   (item) =>

&#x20;     item?.type === "file" &&

&#x20;     String(item?.name || "")

&#x20;       .toLowerCase()

&#x20;       .endsWith(".json")

&#x20; );

}



*/\*\**

*&#x20;\* @param {any} item*

*&#x20;\* @param {any} env*

*&#x20;\* @returns {Promise\<QueueRecord>}*

*&#x20;\*/*

async function readQueueFile(item, env) {

&#x20; const fileData =

&#x20;   await githubJson(item.url, env);



&#x20; const decoded =

&#x20;   base64ToUtf8(fileData.content || "");



*/\*\* @type {Story} \*/*

&#x20; const story =

&#x20;   JSON.parse(decoded);



&#x20; return {

&#x20;   item,

&#x20;   sha:

&#x20;     fileData.sha ||

&#x20;     item.sha ||

&#x20;     null,



&#x20;   path:

&#x20;     fileData.path ||

&#x20;     item.path ||

&#x20;     \`${QUEUE\_PATH}/${item.name}\`,



&#x20;   story,

&#x20;   error: null,

&#x20; };

}



*/\*\**

*&#x20;\* @param {any} env*

*&#x20;\* @returns {Promise\<QueueRecord[]>}*

*&#x20;\*/*

async function getQueueState(env) {

&#x20; const files =

&#x20;   await listQueueFiles(env);



*/\*\* @type {QueueRecord[]} \*/*

&#x20; const records = [];



&#x20; for (const item of files) {

&#x20;   try {

&#x20;     records.push(

&#x20;       await readQueueFile(item, env)

&#x20;     );

&#x20;   error\_message: safeMessage

&#x20;     records.push({

&#x20;       item,



&#x20;       sha:

&#x20;         item?.sha ||

&#x20;         null,



&#x20;       path:

&#x20;         item?.path ||

&#x20;         \`${QUEUE\_PATH}/${item?.name || "unknown.json"}\`,



&#x20;       story: null,



&#x20;       error:

&#x20;         errorMessage(error),

&#x20;     });

&#x20;   }



&#x20; return records;





*/\*\* @param {Story} story \*/*

function storyPriority(story) {

&#x20; const breaking =

&#x20;   story.breaking === true ||
&#x20;   String(story.priority || "")

&#x20;     .toLowerCase() === "breaking";



&#x20; const status =

&#x20;   String(story.status || "")

&#x20;     .toLowerCase();



&#x20; if (

&#x20;   breaking &&

&#x20;   status === "blocked\_media"

&#x20; ) {

&#x20;   return 400;

&#x20; }



&#x20; if (

&#x20;   breaking &&

&#x20;   status === "ready\_to\_publish"

&#x20; ) {

&#x20;   return 390;

&#x20; }



&#x20; if (status === "blocked\_media") {

&#x20;   return 300;

&#x20; }



&#x20; if (status === "ready\_to\_publish") {

&#x20;   return 200;

&#x20; }



&#x20; return 0;

}



*/\*\**

*&#x20;\* @param {QueueRecord[]} records*

*&#x20;\* @returns {QueueRecord|null}*

*&#x20;\*/*

function selectQueueRecord(records) {

&#x20; const candidates =

&#x20;   records

&#x20;     .filter((record) => {

&#x20;       const story =

&#x20;         record.story;



&#x20;       if (!story) {

&#x20;         return false;

&#x20;       }



&#x20;       if (

&#x20;         story.instagram\_media\_id

&#x20;       ) {

&#x20;         return false;

&#x20;       }



&#x20;       const status =

&#x20;         String(story.status || "")

&#x20;           .toLowerCase();



&#x20;       if (

&#x20;         status === "published"

&#x20;       ) {

&#x20;         return false;

&#x20;       }



&#x20;       if (

&#x20;         status ===

&#x20;           "ready\_to\_publish" &&

&#x20;         story.public\_image\_url

&#x20;       ) {

&#x20;         return false;

&#x20;       }



&#x20;       return (

&#x20;         status ===

&#x20;           "blocked\_media" ||

&#x20;         status ===

&#x20;           "ready\_to\_publish"

&#x20;       );

&#x20;     })

&#x20;     .sort((a, b) => {

&#x20;       const aStory =

*/\*\* @type {Story} \*/*

&#x20;         (a.story);



&#x20;       const bStory =

*/\*\* @type {Story} \*/*

&#x20;         (b.story);



&#x20;       const priorityDifference =

&#x20;         storyPriority(bStory) -

&#x20;         storyPriority(aStory);



&#x20;       if (

&#x20;         priorityDifference !== 0

&#x20;       ) {

&#x20;         return priorityDifference;

&#x20;       }



&#x20;       const ta =

&#x20;         Date.parse(

&#x20;           aStory.timestamp || ""

&#x20;         ) || 0;



&#x20;       const tb =

&#x20;         Date.parse(

&#x20;           bStory.timestamp || ""

&#x20;         ) || 0;



&#x20;       return tb - ta;

&#x20;     });



&#x20; return candidates[0] || null;

}



*/\*\**

*&#x20;\* @param {QueueRecord} record*

*&#x20;\* @param {any} env*

*&#x20;\* @param {string} message*

*&#x20;\*/*

async function updateQueueFile(

&#x20; record,

&#x20; env,

&#x20; message

) {

&#x20; if (!record.story) {

&#x20;   throw new Error(

&#x20;     "Cannot update queue item without story data"

&#x20;   );

&#x20; }



&#x20; if (!record.sha) {

&#x20;   throw new Error(

&#x20;     "Cannot update queue item without GitHub SHA"

&#x20;   );

&#x20; }



&#x20; const content =

&#x20;   JSON.stringify(

&#x20;     record.story,

&#x20;     null,

&#x20;     2

&#x20;   ) + "\n";



&#x20; const encodedPath =

&#x20;   record.path

&#x20;     .split("/")

&#x20;     .map(encodeURIComponent)

&#x20;     .join("/");



&#x20; const result =

&#x20;   await githubJson(

&#x20;     \`${GITHUB\_API}/contents/${encodedPath}\`,

&#x20;     env,

&#x20;     {

&#x20;       method: "PUT",



&#x20;       headers: {

&#x20;         "content-type":

&#x20;           "application/json",

&#x20;       },



&#x20;       body: JSON.stringify({

&#x20;         message,



&#x20;         content:

&#x20;           utf8ToBase64(content),



&#x20;         sha:

&#x20;           record.sha,

&#x20;       }),

&#x20;     }

&#x20;   );



&#x20; if (

&#x20;   result?.content?.sha

&#x20; ) {

&#x20;   record.sha =

&#x20;     result.content.sha;

&#x20; }



&#x20; return result;

}



*/\*\**

*&#x20;\* @param {Story} story*

*&#x20;\* @param {any} env*

*&#x20;\*/*

async function generateBackground(

&#x20; story,

&#x20; env

) {

&#x20; const headline =

&#x20;   story.headline ||

&#x20;   "Global news update";



&#x20; const category =

&#x20;   story.category ||

&#x20;   "World News";



&#x20; const visualBrief =

&#x20;   story.image\_generation\_prompt ||

&#x20;   "";



&#x20; const prompt = [

&#x20; "Create a clean premium editorial background illustration for an international news card.",

&#x20; \`Story subject: ${headline}.\`,

&#x20; \`Category: ${category}.\`,

&#x20; "Use cinematic abstract visual storytelling only.",

&#x20; "For geopolitical stories use atmospheric Arctic landscapes, ice, ocean, subtle geometric shapes and strategic-light motifs.",

&#x20; "Do NOT create maps with labels.",

&#x20; "Do NOT create charts, documents, newspapers, screens, signs or interface panels.",

&#x20; "Do NOT include flags containing symbols or writing.",

&#x20; "Absolutely no readable or unreadable text anywhere in the image.",

&#x20; "No letters, numbers, pseudo-writing, glyphs, captions, labels or typography.",

&#x20; "Background artwork only.",

&#x20; "Professional international newsroom aesthetic.",

&#x20; "Realistic lighting, restrained composition, sophisticated blue and neutral tones.",

&#x20; "Leave the lower third visually simple and dark for headline overlay."

].join(" "); &#x20;



&#x20; const result =

&#x20;   await env.AI.run(

&#x20;     IMAGE\_MODEL,

&#x20;     {

&#x20;       prompt,



&#x20;       negative\_prompt:

&#x20; "text, fake text, gibberish, pseudo text, letters, alphabet, numbers, labels, map labels, place names, typography, captions, newspaper, document, UI, signs, watermark, logo, chart, infographic, blurry, distorted, gore",

&#x20;       width: 1080,



&#x20;       height: 1344,



&#x20;       num\_steps: 20,

&#x20;     }

&#x20;   );



&#x20; const buffer =

&#x20;   await new Response(result)

&#x20;     .arrayBuffer();



&#x20; const bytes =

&#x20;   new Uint8Array(buffer);



&#x20; if (!bytes.length) {

&#x20;   throw new Error(

&#x20;     "Workers AI returned an empty background image"

&#x20;   );

&#x20; }



&#x20; const mime =

&#x20;   detectImageMime(bytes);



&#x20; if (

&#x20;   !mime.startsWith("image/")

&#x20; ) {

&#x20;   throw new Error(

&#x20;     \`Workers AI returned unsupported media type: ${mime}\`

&#x20;   );

&#x20; }



&#x20; return {

&#x20;   bytes,



&#x20;   mime,



&#x20;   dataUrl:

&#x20;     \`data:${mime};base64,${bytesToBase64(bytes)}\`,

&#x20; };

}



*/\*\**

*&#x20;\* @param {Story} story*

*&#x20;\* @param {string} backgroundDataUrl*

*&#x20;\*/*

function buildCardHtml(

&#x20; story,

&#x20; backgroundDataUrl

) {

&#x20; const headline =

&#x20;   story.headline ||

&#x20;   "MATRIX 24";



&#x20; const category =

&#x20;   story.category ||

&#x20;   "WORLD NEWS";



&#x20; const sourceLabel =

&#x20;   sourceLabelFromUrls(

&#x20;     story.verified\_source\_urls ||

&#x20;     []

&#x20;   );



&#x20; const fontSize =

&#x20;   headlineFontSize(headline);



&#x20; return \`\<!doctype html>

\<html>

\<head>

\<meta charset="utf-8">



\<style>



\* {

&#x20; box-sizing: border-box;

}



html,

body {

&#x20; margin: 0;



&#x20; width: 1080px;

&#x20; height: 1350px;



&#x20; overflow: hidden;



&#x20; font-family:

&#x20;   Arial,

&#x20;   Helvetica,

&#x20;   sans-serif;



&#x20; background:

&#x20;   \#080b10;



&#x20; color:

&#x20;   \#ffffff;

}



.card {

&#x20; width:

&#x20;   1080px;



&#x20; height:

&#x20;   1350px;



&#x20; position:

&#x20;   relative;



&#x20; overflow:

&#x20;   hidden;



&#x20; background:

&#x20;   linear-gradient(

&#x20;     to bottom,

&#x20;     rgba(5,8,12,.18) 0%,

&#x20;     rgba(5,8,12,.28) 42%,

&#x20;     rgba(5,8,12,.96) 100%

&#x20;   ),

&#x20;   url("${backgroundDataUrl}")

&#x20;     center center /

&#x20;     cover

&#x20;     no-repeat;

}



.grid {

&#x20; position:

&#x20;   absolute;



&#x20; inset:

&#x20;   0;



&#x20; opacity:

&#x20;   .08;



&#x20; background-image:

&#x20;   linear-gradient(

&#x20;     rgba(255,255,255,.22) 1px,

&#x20;     transparent 1px

&#x20;   ),

&#x20;   linear-gradient(

&#x20;     90deg,

&#x20;     rgba(255,255,255,.22) 1px,

&#x20;     transparent 1px

&#x20;   );



&#x20; background-size:

&#x20;   72px 72px;

}



.vignette {

&#x20; position:

&#x20;   absolute;



&#x20; inset:

&#x20;   0;



&#x20; background:

&#x20;   radial-gradient(

&#x20;     circle at 50% 33%,

&#x20;     transparent 18%,

&#x20;     rgba(0,0,0,.10) 62%,

&#x20;     rgba(0,0,0,.56) 100%

&#x20;   );

}



.topbar {

&#x20; position:

&#x20;   absolute;



&#x20; top:

&#x20;   70px;



&#x20; left:

&#x20;   72px;



&#x20; right:

&#x20;   72px;



&#x20; display:

&#x20;   flex;



&#x20; justify-content:

&#x20;   space-between;



&#x20; align-items:

&#x20;   center;



&#x20; gap:

&#x20;   36px;

}



.brand {

&#x20; font-size:

&#x20;   42px;



&#x20; font-weight:

&#x20;   800;



&#x20; letter-spacing:

&#x20;   3px;



&#x20; white-space:

&#x20;   nowrap;



&#x20; text-shadow:

&#x20;   0 2px 12px

&#x20;   rgba(0,0,0,.55);

}



.category {

&#x20; font-size:

&#x20;   22px;



&#x20; line-height:

&#x20;   1.2;



&#x20; letter-spacing:

&#x20;   1.8px;



&#x20; font-weight:

&#x20;   700;


&#x20; opacity:

&#x20;   .9;



&#x20; text-align:

&#x20;   right;



&#x20; max-width:

&#x20;   500px;



&#x20; text-shadow:

&#x20;   0 2px 12px

&#x20;   rgba(0,0,0,.55);

}



.headline {

&#x20; position:

&#x20;   absolute;



&#x20; left:

&#x20;   72px;



&#x20; right:

&#x20;   72px;



&#x20; bottom:

&#x20;   246px;



&#x20; font-size:

&#x20;   ${fontSize}px;



&#x20; line-height:

&#x20;   1.04;



&#x20; font-weight:

&#x20;   800;



&#x20; letter-spacing:

&#x20;   -1.8px;



&#x20; text-shadow:

&#x20;   0 3px 18px

&#x20;   rgba(0,0,0,.72);

}



.rule {

&#x20; position:

&#x20;   absolute;



&#x20; left:

&#x20;   72px;



&#x20; bottom:

&#x20;   190px;



&#x20; width:

&#x20;   180px;



&#x20; height:

&#x20;   8px;



&#x20; background:

&#x20;   \#ffffff;



&#x20; box-shadow:

&#x20;   0 2px 10px

&#x20;   rgba(0,0,0,.45);

}



.source {

&#x20; position:

&#x20;   absolute;



&#x20; left:

&#x20;   72px;



&#x20; bottom:

&#x20;   108px;



&#x20; font-size:

&#x20;   25px;



&#x20; font-weight:

&#x20;   600;



&#x20; opacity:

&#x20;   .9;



&#x20; max-width:

&#x20;   480px;



&#x20; text-shadow:

&#x20;   0 2px 12px

&#x20;   rgba(0,0,0,.6);

}



.ai-label {

&#x20; position:

&#x20;   absolute;



&#x20; right:

&#x20;   72px;



&#x20; bottom:

&#x20;   104px;



&#x20; font-size:

&#x20;   18px;



&#x20; line-height:

&#x20;   1.3;



&#x20; font-weight:

&#x20;   700;



&#x20; letter-spacing:

&#x20;   .5px;



&#x20; opacity:

&#x20;   .72;



&#x20; text-align:

&#x20;   right;



&#x20; max-width:

&#x20;   390px;



&#x20; text-shadow:

&#x20;   0 2px 12px

&#x20;   rgba(0,0,0,.65);

}



\</style>

\</head>



\<body>



\<div class="card">



&#x20; \<div class="grid">\</div>



&#x20; \<div class="vignette">\</div>



&#x20; \<div class="topbar">



&#x20;   \<div class="brand">

&#x20;     MATRIX 24

&#x20;   \</div>



&#x20;   \<div class="category">

&#x20;     ${escapeHtml(

&#x20;       category.toUpperCase()

&#x20;     )}

&#x20;   \</div>



&#x20; \</div>



&#x20; \<div class="headline">

&#x20;   ${escapeHtml(headline)}

&#x20; \</div>



&#x20; \<div class="rule">\</div>



&#x20; \<div class="source">

&#x20;   Sources:

&#x20;   ${escapeHtml(sourceLabel)}

&#x20; \</div>



&#x20; \<div class="ai-label">

&#x20;   AI-GENERATED EDITORIAL VISUAL

&#x20;   \<br>

&#x20;   NOT DOCUMENTARY PHOTOGRAPHY

&#x20; \</div>



\</div>



\</body>

\</html>\`;

}



*/\*\**

*&#x20;\* @param {Story} story*

*&#x20;\* @param {any} env*

*&#x20;\*/*

async function renderFinalJpeg(

&#x20; story,

&#x20; env

) {

&#x20; const background =

&#x20;   await generateBackground(

&#x20;     story,

&#x20;     env

&#x20;   );



&#x20; const html =

&#x20;   buildCardHtml(

&#x20;     story,

&#x20;     background.dataUrl

&#x20;   );



&#x20; const screenshotResponse =

&#x20;   await env.BROWSER.quickAction(

&#x20;     "screenshot",

&#x20;     {

&#x20;       html,



&#x20;       viewport: {

&#x20;         width:

&#x20;           1080,



&#x20;         height:

&#x20;           1350,

&#x20;       },



&#x20;       screenshotOptions: {

&#x20;         type:

&#x20;           "jpeg",



&#x20;         quality:

&#x20;           92,



&#x20;         fullPage:

&#x20;           false,

&#x20;       },

&#x20;     }

&#x20;   );



&#x20; if (

&#x20;   !screenshotResponse?.ok

&#x20; ) {

&#x20;   throw new Error(

&#x20;     \`Browser Run screenshot failed: ${

&#x20;       screenshotResponse?.status ||

&#x20;       "unknown"

&#x20;     }\`

&#x20;   );

&#x20; }



&#x20; const jpegBytes =

&#x20;   new Uint8Array(

&#x20;     await screenshotResponse

&#x20;       .arrayBuffer()

&#x20;   );



&#x20; if (

&#x20;   !isJpeg(jpegBytes)

&#x20; ) {

&#x20;   throw new Error(

&#x20;     "Browser Run did not return a real JPEG"

&#x20;   );

&#x20; }



&#x20; if (

&#x20;   !jpegBytes.byteLength

&#x20; ) {

&#x20;   throw new Error(

&#x20;     "Rendered JPEG is empty"

&#x20;   );

&#x20; }



&#x20; if (

&#x20;   jpegBytes.byteLength >

&#x20;   MAX\_JPEG\_BYTES

&#x20; ) {

&#x20;   throw new Error(

&#x20;     \`Rendered JPEG exceeds 8 MB (${jpegBytes.byteLength} bytes)\`

&#x20;   );

&#x20; }



&#x20; return jpegBytes;

}



*/\*\**

*&#x20;\* @param {Uint8Array} jpegBytes*

*&#x20;\* @param {string} filename*

*&#x20;\* @param {any} env*

*&#x20;\*/*

async function uploadJpegToSupabase(

&#x20; jpegBytes,

&#x20; filename,

&#x20; env

) {

&#x20; const uploadUrl =

&#x20;   \`${storageBase(env)}/storage/v1/object/\` +

&#x20;   \`${env.SUPABASE\_BUCKET}/${filename}\`;



&#x20; const uploadResponse =

&#x20;   await fetch(

&#x20;     uploadUrl,

&#x20;     {

&#x20;       method:

&#x20;         "POST",

&#x20;       redirect: "error",

&#x20;       signal: AbortSignal.timeout(15000),



&#x20;       headers: {

&#x20;         Authorization:

&#x20;           \`Bearer ${env.SUPABASE\_SECRET\_KEY}\`,



&#x20;         apikey:

&#x20;           env.SUPABASE\_SECRET\_KEY,



&#x20;         "Content-Type":

&#x20;           "image/jpeg",



&#x20;         "x-upsert":

&#x20;           "false",

&#x20;       },



&#x20;       body:

&#x20;         jpegBytes,

&#x20;     }

&#x20;   );



&#x20; const uploadText =

&#x20;   await uploadResponse.text();



&#x20; if (

&#x20;   !uploadResponse.ok

&#x20; ) {

&#x20;   throw new Error(

&#x20;     \`STORAGE\_UPLOAD\_FAILED\_${uploadResponse.status}\`

&#x20;   );

&#x20; }



&#x20; const publicUrl =

&#x20;   \`${storageBase(env)}/storage/v1/object/public/\` +

&#x20;   \`${env.SUPABASE\_BUCKET}/${filename}\`;



&#x20; if (!(await existingJpeg(publicUrl))) throw new SafeError('MEDIA\_RECONCILIATION\_REQUIRED');



&#x20; return publicUrl;

}





*/\*\* Atomic GitHub SHA claim precedes all paid or storage operations.*

*&#x20;\* Claims never expire automatically: an interrupted run needs reconciliation.*

*&#x20;\*/*

async function processQueue(env) {

&#x20; let record = null; let claimed = false;

&#x20; const requestId = crypto.randomUUID();

&#x20; try {

&#x20;   const records = await getQueueState(env);

&#x20;   if (records.some(r => r.error)) throw new SafeError('QUEUE\_READ\_FAILED');

&#x20;   const ids = new Set();

&#x20;   for (const r of records) {

&#x20;     const id = r.story?.content\_id;

&#x20;     if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new SafeError('QUEUE\_ID\_INVALID\_OR\_DUPLICATE');

&#x20;     ids.add(id);

&#x20;   }

&#x20;   record = selectQueueRecord(records);

&#x20;   if (!record?.story) return {success:true, action:'none', pending\_recovery:records.filter(r => r.story?.status === 'processing\_media').length};

&#x20;   const story = record.story;

&#x20;   if (!story.headline || !Array.isArray(story.verified\_source\_urls) || !story.verified\_source\_urls.length) throw new SafeError('QUEUE\_CONTENT\_INVALID');

&#x20;   const priorUrl = story.public\_image\_url ? checkedImageUrl(story.public\_image\_url, env) : null;

&#x20;   const filename = \`matrix24-${await sha256(story.content\_id)}-v1.jpg\`;

&#x20;   const publicUrl = priorUrl || \`${storageBase(env)}/storage/v1/object/public/${env.SUPABASE\_BUCKET}/${filename}\`;

&#x20;   story.status = 'processing\_media';

&#x20;   story.media\_claim = {id:requestId, started\_at:nowIso()};

*// A lost claim response leaves a durable reservation; never retry blindly.*

&#x20;   await updateQueueFile(record, env, \`MATRIX 24: reserve ${story.content\_id}\`);

&#x20;   claimed = true;

&#x20;   let bytes = null;

&#x20;   const exists = await existingJpeg(publicUrl);

&#x20;   if (!exists) {

&#x20;     if (priorUrl) throw new SafeError('EXISTING\_MEDIA\_MISSING');

&#x20;     bytes = await renderFinalJpeg(story, env);

&#x20;     await uploadJpegToSupabase(bytes, filename, env);

&#x20;   }

&#x20;   story.status = 'ready\_to\_publish';

&#x20;   story.public\_image\_url = publicUrl;

&#x20;   story.image\_filename = priorUrl ? story.image\_filename : filename;

&#x20;   story.media\_ready\_at = nowIso();

&#x20;   if (bytes) story.image\_spec = {format:'JPEG', mode:'RGB', width:1080, height:1350, size\_bytes:bytes.length, alpha:false};

&#x20;   delete story.media\_claim;

&#x20;   appendAttempt(story, {stage:'media\_pipeline', result:exists ? 'reused\_existing\_media' : 'success', request\_id:requestId, image\_filename:story.image\_filename, public\_image\_url:publicUrl});

&#x20;   await updateQueueFile(record, env, \`MATRIX 24: media ready for ${story.content\_id}\`);

&#x20;   return {success:true, action:exists ? 'already\_ready' : 'media\_created', content\_id:story.content\_id, public\_image\_url:publicUrl};

&#x20; }  catch (error) {

*// Preserve safe state. Do not retry or overwrite anything here.*

&#x20; const code =

&#x20;   error instanceof SafeError

&#x20;     ? error.code

&#x20;     : claimed

&#x20;       ? 'MEDIA\_RECONCILIATION\_REQUIRED'

&#x20;       : 'QUEUE\_OR\_CLAIM\_FAILED';



&#x20; const rawMessage =

&#x20;   error && error.message

&#x20;     ? String(error.message)

&#x20;     : 'Unknown error';



*// Basic sanitization: never expose credentials in logs.*

&#x20; const safeMessage = rawMessage

&#x20;   .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')

&#x20;   .replace(/token[=:]\s\*[^\s"']+/gi, 'token=[REDACTED]')

&#x20;   .replace(/apikey[=:]\s\*[^\s"']+/gi, 'apikey=[REDACTED]');



&#x20; console.error(JSON.stringify({

&#x20;   event: 'matrix24\_media\_failed',

&#x20;   request\_id: requestId,

&#x20;   code,

&#x20;   claimed,

&#x20;   error\_name: error?.name || 'Error',

&#x20;   error\_message: safeMessage,

&#x20;   queue\_file: record?.path || record?.item?.name || null,

&#x20;   content\_id: record?.story?.content\_id || null

&#x20; }));



&#x20; return {

&#x20;   success: false,

&#x20;   action: 'media\_failed',

&#x20;   error: code,

&#x20;   request\_id: requestId

&#x20; };

}

}



async function legacyUpload(request, env, url) {

&#x20; let bytes;

&#x20; const source = url.searchParams.get('image\_url');

&#x20; if (source) {

&#x20;   const safeUrl = checkedImageUrl(source, env);

&#x20;   const response = await fetch(safeUrl, {redirect:'error', signal:AbortSignal.timeout(15000)});

&#x20;   if (!response.ok) throw new SafeError('IMAGE\_DOWNLOAD\_FAILED', 400);

&#x20;   bytes = await boundedBytes(response);

&#x20; } else {

&#x20;   if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'image/jpeg') throw new SafeError('JPEG\_REQUIRED', 415);

&#x20;   bytes = await boundedBytes(request);

&#x20; }

&#x20; if (!isJpeg(bytes)) throw new SafeError('JPEG\_REQUIRED', 415);

*// Repeated upload of identical bytes reuses the same object.*

&#x20; const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');

&#x20; const filename = \`upload-${digest}.jpg\`;

&#x20; const publicUrl = \`${storageBase(env)}/storage/v1/object/public/${env.SUPABASE\_BUCKET}/${filename}\`;

&#x20; if (!(await existingJpeg(publicUrl))) {

&#x20;   try { await uploadJpegToSupabase(bytes, filename, env); }

&#x20;   catch (error) { if (!(await existingJpeg(publicUrl))) throw error; }

&#x20; }

&#x20; return json({success:true, filename, public\_url:publicUrl, bytes:bytes.length, content\_type:'image/jpeg', verified\_public:true});

}





export default {

&#x20; async fetch(request, env) {

&#x20;   const url = new URL(request.url);

&#x20;   const method = request.method.toUpperCase();

&#x20;   if (method === 'GET' && ['/', '/health'].includes(url.pathname)) return json({status:'ok', service:'matrix24-publisher'});

*// Diagnostic routes are absent in production, including expensive AI/browser tests.*

&#x20;   if (!['/process-queue','/upload','/'].includes(url.pathname)) return json({error:'Not found'},404);

&#x20;   if (method !== 'POST') return new Response(JSON.stringify({error:'Method not allowed'}), {status:405, headers:{'allow':'POST','content-type':'application/json','cache-control':'no-store'}});
&#x20;   if (!(await authorized(request, env))) return json({error:'Unauthorized'},401);

&#x20;   try {

&#x20;     if (url.pathname === '/process-queue') {

&#x20;       const result = await processQueue(env);

&#x20;       return json(result, result.success ? 200 : 503);

&#x20;     }

&#x20;     return await legacyUpload(request, env, url);

&#x20;   } catch (error) {

&#x20;     const id = crypto.randomUUID();

&#x20;     const code = error instanceof SafeError ? error.code : 'REQUEST\_FAILED';

&#x20;     console.error(JSON.stringify({event:'matrix24\_request\_failed', request\_id:id, code}));

&#x20;     return json({error:code, request\_id:id}, error instanceof SafeError ? error.status : 500);

&#x20;   }

&#x20; },

&#x20; async scheduled(\_controller, env, ctx) { ctx.waitUntil(processQueue(env)); },

};