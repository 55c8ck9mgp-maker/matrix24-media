// @ts-nocheck



const REPO = "55c8ck9mgp-maker/matrix24-media";

const QUEUE_PATH = "queue";

const GITHUB_API = `https://api.github.com/repos/${REPO}`;

const VERSION = "3.2.0";

const MAX_JPEG_BYTES = 8 * 1024 * 1024;

const IMAGE_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning";





class SafeError extends Error {

  constructor(code, status = 500) { super(code); this.code = code; this.status = status; }

}



async function sha256(value) {

  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');

}



async function authorized(request, env) {

  const secret = env.MATRIX24_API_TOKEN;

  if (typeof secret !== 'string' || secret.length < 32) return false;

  const supplied = request.headers.get('authorization') || '';

  if (!supplied.startsWith('Bearer ') || supplied.length > 512) return false;

  const a = await sha256(supplied.slice(7));

  const b = await sha256(secret);

  let difference = 0;

  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);

  return difference === 0;

}



function storageBase(env) {

  const u = new URL(env.SUPABASE_URL);

  if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.endsWith('.supabase.co')) throw new SafeError('STORAGE_CONFIG_INVALID');

  if (!/^[a-zA-Z0-9_-]+$/.test(env.SUPABASE_BUCKET || '')) throw new SafeError('STORAGE_CONFIG_INVALID');

  return u.origin;

}



function checkedImageUrl(value, env) {

  let u;

  try { u = new URL(value); } catch { throw new SafeError('IMAGE_URL_NOT_ALLOWED', 400); }

  const prefix = `/storage/v1/object/public/${env.SUPABASE_BUCKET}/`;

  if (u.origin !== storageBase(env) || u.username || u.password || u.search || u.hash || !u.pathname.startsWith(prefix) || u.pathname.length <= prefix.length) throw new SafeError('IMAGE_URL_NOT_ALLOWED', 400);

  return u.href;

}



async function boundedBytes(response, limit = MAX_JPEG_BYTES) {

  const declared = Number(response.headers.get('content-length'));

  if (declared > limit) { await response.body?.cancel(); throw new SafeError('IMAGE_TOO_LARGE', 413); }

  if (!response.body) throw new SafeError('EMPTY_IMAGE', 400);

  const reader = response.body.getReader();

  const parts = []; let size = 0; let timer;

  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reject(new SafeError('IMAGE_READ_TIMEOUT', 408)); void reader.cancel(); }, 15000); });

  try {

    while (true) {

      const {done, value} = await Promise.race([reader.read(), timeout]);

      if (done) break;

      size += value.byteLength;

      if (size > limit) throw new SafeError('IMAGE_TOO_LARGE', 413);

      parts.push(value);

    }

    if (!size) throw new SafeError('EMPTY_IMAGE', 400);

    const bytes = new Uint8Array(size); let offset = 0;

    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }

    return bytes;

  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }

}



async function existingJpeg(url) {

  const response = await fetch(url, {method:'HEAD', redirect:'error', signal:AbortSignal.timeout(15000)});

  if (response.status === 404) return false;

// Supabase can wrap NoSuchKey in HTTP 400; HEAD hides that JSON body.

  if (response.status === 400) {

    const detail = await fetch(url, {method:'GET', redirect:'error', signal:AbortSignal.timeout(15000)});

    if (detail.status === 400 && (detail.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {

      const error = JSON.parse(new TextDecoder().decode(await boundedBytes(detail, 4096)));

      if (String(error.statusCode) === '404' && error.code === 'NoSuchKey') return false;

    } else {

      await detail.body?.cancel();

    }

    throw new SafeError('MEDIA_RECONCILIATION_REQUIRED');

  }

  if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/jpeg')) throw new SafeError('MEDIA_RECONCILIATION_REQUIRED');

  return true;

}



/**

 * @typedef {{

 * timestamp?: string,

 * content_id?: string,

 * status?: string,

 * headline?: string,

 * category?: string,

 * verified_source_urls?: string[],

 * caption?: string,

 * hashtags?: string[],

 * image_filename?: string,

 * image_generation_prompt?: string,

 * public_image_url?: string|null,

 * instagram_media_id?: string|null,

 * instagram_permalink?: string|null,

 * publish_attempt_history?: any[],

 * priority?: string,

 * breaking?: boolean,

 * media_ready_at?: string,

 * image_spec?: any,

 * [key:string]: any

 * }} Story

 */



/**

 * @typedef {{

 * item: any,

 * sha: string|null,

 * path: string,

 * story: Story|null,

 * error: string|null

 * }} QueueRecord

 */



/** @param {any} data @param {number} [status] */

function json(data, status = 200) {

  return new Response(JSON.stringify(data, null, 2), {

    status,

    headers: {

      "content-type": "application/json; charset=utf-8",

      "cache-control": "no-store",

    },

  });

}



/** @param {any} env */

function githubHeaders(env) {

  return {

    Authorization: `Bearer ${env.GITHUB_TOKEN}`,

    Accept: "application/vnd.github+json",

    "User-Agent": "matrix24-publisher",

    "X-GitHub-Api-Version": "2022-11-28",

  };

}



/** @param {unknown} error */

function errorMessage(error) {

  return error instanceof Error

    ? error.message

    : String(error || "Unknown error");

}



/** @param {unknown} value */

function escapeHtml(value = "") {

  return String(value)

    .replaceAll("&", "&amp;")

    .replaceAll("<", "&lt;")

    .replaceAll(">", "&gt;")

    .replaceAll('"', "&quot;")

    .replaceAll("'", "&#039;");

}



/** @param {Uint8Array} bytes */

function bytesToBase64(bytes) {

  let binary = "";

  const chunkSize = 0x8000;



  for (let i = 0; i < bytes.length; i += chunkSize) {

    binary += String.fromCharCode(

      ...bytes.subarray(i, i + chunkSize)

    );

  }



  return btoa(binary);

}



/** @param {string} value */

function utf8ToBase64(value) {

  return bytesToBase64(

    new TextEncoder().encode(value)

  );

}



/** @param {string} value */

function base64ToUtf8(value) {

  const clean = String(value || "")

    .replace(/\s/g, "");



  const binary = atob(clean);



  const bytes = Uint8Array.from(

    binary,

    (char) => char.charCodeAt(0)

  );



  return new TextDecoder("utf-8").decode(bytes);

}



/** @param {Uint8Array} bytes */

function detectImageMime(bytes) {

  if (

    bytes.length >= 3 &&

    bytes[0] === 0xff &&

    bytes[1] === 0xd8 &&

    bytes[2] === 0xff

  ) {

    return "image/jpeg";

  }



  if (

    bytes.length >= 8 &&

    bytes[0] === 0x89 &&

    bytes[1] === 0x50 &&

    bytes[2] === 0x4e &&

    bytes[3] === 0x47

  ) {

    return "image/png";

  }



  return "application/octet-stream";

}



/** @param {Uint8Array} bytes */

function isJpeg(bytes) {

  return detectImageMime(bytes) === "image/jpeg";

}



/** @param {unknown} value */

function safeFilename(value) {

  return (

    String(value || "matrix24")

      .toLowerCase()

      .replace(/[^a-z0-9-_]+/g, "-")

      .replace(/^-+|-+$/g, "")

      .slice(0, 120) ||

    "matrix24"

  );

}



/** @param {string[]} urls */

function sourceLabelFromUrls(urls = []) {

/** @type {string[]} */

  const labels = [];



  for (const sourceUrl of urls) {

    try {

      const host =

        new URL(sourceUrl).hostname.toLowerCase();



      let label;



      if (host.includes("reuters.com")) {

        label = "Reuters";

      } else if (host.includes("apnews.com")) {

        label = "AP";

      } else if (host.includes("bbc.")) {

        label = "BBC";

      } else if (host.includes("un.org")) {

        label = "UN";

      } else if (host.includes("noaa.gov")) {

        label = "NOAA";

      } else if (host.includes("nasa.gov")) {

        label = "NASA";

      } else {

        label = host.replace(/^www\\./, "");

      }



      if (!labels.includes(label)) {

        labels.push(label);

      }

    } catch {

// Ignore malformed source URLs.

    }

  }



  return labels.length

    ? labels.join(" / ")

    : "Verified sources";

}



/** @param {unknown} headline */

function headlineFontSize(headline) {

  const length =

    String(headline || "").length;



  if (length > 115) return 50;

  if (length > 95) return 56;

  if (length > 75) return 62;

  if (length > 55) return 68;



  return 76;

}



function nowIso() {

  return new Date().toISOString();

}



/** @param {Story} story @param {any} attempt */

function appendAttempt(story, attempt) {

  const history =

    Array.isArray(story.publish_attempt_history)

      ? story.publish_attempt_history

      : [];



  history.push({

    timestamp: nowIso(),

    ...attempt,

  });



  story.publish_attempt_history =

    history.slice(-50);

}



/**

 * @param {string} url

 * @param {any} env

 * @param {RequestInit} [options]

 */

async function githubJson(

  url,

  env,

  options = {}

) {

  const response = await fetch(url, {

    ...options,

    redirect: "error",

    signal: AbortSignal.timeout(15000),

    headers: {

      ...githubHeaders(env),

      ...(options.headers || {}),

    },

  });



  const text = await response.text();



/** @type {any} */

  let body = null;



  if (text) {

    try {

      body = JSON.parse(text);

    } catch {

      body = text;

    }

  }



  if (!response.ok) {

    const message =

      typeof body === "string"

        ? body

        : JSON.stringify(body || {});



    throw new Error(

      `GITHUB_REQUEST_FAILED_${response.status}`

    );

  }



  return body;

}



/** @param {any} env */

async function listQueueFiles(env) {

  const items = await githubJson(

    `${GITHUB_API}/contents/${QUEUE_PATH}`,

    env

  );



  if (!Array.isArray(items)) {

    return [];

  }



  return items.filter(

    (item) =>

      item?.type === "file" &&

      String(item?.name || "")

        .toLowerCase()

        .endsWith(".json")

  );

}



/**

 * @param {any} item

 * @param {any} env

 * @returns {Promise<QueueRecord>}

 */

async function readQueueFile(item, env) {

  const fileData =

    await githubJson(item.url, env);



  const decoded =

    base64ToUtf8(fileData.content || "");



/** @type {Story} */

  const story =

    JSON.parse(decoded);



  return {

    item,

    sha:

      fileData.sha ||

      item.sha ||

      null,



    path:

      fileData.path ||

      item.path ||

      `${QUEUE_PATH}/${item.name}`,



    story,

    error: null,

  };

}



/**

 * @param {any} env

 * @returns {Promise<QueueRecord[]>}

 */

async function getQueueState(env) {

  const files =

    await listQueueFiles(env);



/** @type {QueueRecord[]} */

  const records = [];



  for (const item of files) {

    try {

      records.push(

        await readQueueFile(item, env)

      );

    } catch (error) {

      records.push({

        item,



        sha:

          item?.sha ||

          null,



        path:

          item?.path ||

          `${QUEUE_PATH}/${item?.name || "unknown.json"}`,



        story: null,



        error:

          errorMessage(error),

      });

    }

  }



  return records;

}



/** @param {Story} story */

function storyPriority(story) {

  const breaking =

    story.breaking === true ||
    String(story.priority || "")

      .toLowerCase() === "breaking";



  const status =

    String(story.status || "")

      .toLowerCase();



  if (

    breaking &&

    status === "blocked_media"

  ) {

    return 400;

  }



  if (

    breaking &&

    status === "ready_to_publish"

  ) {

    return 390;

  }



  if (status === "blocked_media") {

    return 300;

  }



  if (status === "ready_to_publish") {

    return 200;

  }



  return 0;

}



/**

 * @param {QueueRecord[]} records

 * @returns {QueueRecord|null}

 */

function selectQueueRecord(records) {

  const candidates =

    records

      .filter((record) => {

        const story =

          record.story;



        if (!story) {

          return false;

        }



        if (

          story.instagram_media_id

        ) {

          return false;

        }



        const status =

          String(story.status || "")

            .toLowerCase();



        if (

          status === "published"

        ) {

          return false;

        }



        if (

          status ===

            "ready_to_publish" &&

          story.public_image_url

        ) {

          return false;

        }



        return (

          status ===

            "blocked_media" ||

          status ===

            "ready_to_publish"

        );

      })

      .sort((a, b) => {

        const aStory =

/** @type {Story} */

          (a.story);



        const bStory =

/** @type {Story} */

          (b.story);



        const priorityDifference =

          storyPriority(bStory) -

          storyPriority(aStory);



        if (

          priorityDifference !== 0

        ) {

          return priorityDifference;

        }



        const ta =

          Date.parse(

            aStory.timestamp || ""

          ) || 0;



        const tb =

          Date.parse(

            bStory.timestamp || ""

          ) || 0;



        return tb - ta;

      });



  return candidates[0] || null;

}



/**

 * @param {QueueRecord} record

 * @param {any} env

 * @param {string} message

 */

async function updateQueueFile(

  record,

  env,

  message

) {

  if (!record.story) {

    throw new Error(

      "Cannot update queue item without story data"

    );

  }



  if (!record.sha) {

    throw new Error(

      "Cannot update queue item without GitHub SHA"

    );

  }



  const content =

    JSON.stringify(

      record.story,

      null,

      2

    ) + "\n";



  const encodedPath =

    record.path

      .split("/")

      .map(encodeURIComponent)

      .join("/");



  const result =

    await githubJson(

      `${GITHUB_API}/contents/${encodedPath}`,

      env,

      {

        method: "PUT",



        headers: {

          "content-type":

            "application/json",

        },



        body: JSON.stringify({

          message,



          content:

            utf8ToBase64(content),



          sha:

            record.sha,

        }),

      }

    );



  if (

    result?.content?.sha

  ) {

    record.sha =

      result.content.sha;

  }



  return result;

}



/**

 * @param {Story} story

 * @param {any} env

 */

async function generateBackground(

  story,

  env

) {

  const headline =

    story.headline ||

    "Global news update";



  const category =

    story.category ||

    "World News";



  const visualBrief =

    story.image_generation_prompt ||

    "";



  const prompt = [

  "Create a clean premium editorial background illustration for an international news card.",

  `Story subject: ${headline}.`,

  `Category: ${category}.`,

  "Use cinematic abstract visual storytelling only.",

  "For geopolitical stories use atmospheric Arctic landscapes, ice, ocean, subtle geometric shapes and strategic-light motifs.",

  "Do NOT create maps with labels.",

  "Do NOT create charts, documents, newspapers, screens, signs or interface panels.",

  "Do NOT include flags containing symbols or writing.",

  "Absolutely no readable or unreadable text anywhere in the image.",

  "No letters, numbers, pseudo-writing, glyphs, captions, labels or typography.",

  "Background artwork only.",

  "Professional international newsroom aesthetic.",

  "Realistic lighting, restrained composition, sophisticated blue and neutral tones.",

  "Leave the lower third visually simple and dark for headline overlay."

].join(" ");  



  const result =

    await env.AI.run(

      IMAGE_MODEL,

      {

        prompt,



        negative_prompt:

  "text, fake text, gibberish, pseudo text, letters, alphabet, numbers, labels, map labels, place names, typography, captions, newspaper, document, UI, signs, watermark, logo, chart, infographic, blurry, distorted, gore",

        width: 1080,



        height: 1344,



        num_steps: 20,

      }

    );



  const buffer =

    await new Response(result)

      .arrayBuffer();



  const bytes =

    new Uint8Array(buffer);



  if (!bytes.length) {

    throw new Error(

      "Workers AI returned an empty background image"

    );

  }



  const mime =

    detectImageMime(bytes);



  if (

    !mime.startsWith("image/")

  ) {

    throw new Error(

      `Workers AI returned unsupported media type: ${mime}`

    );

  }



  return {

    bytes,



    mime,



    dataUrl:

      `data:${mime};base64,${bytesToBase64(bytes)}`,

  };

}



/**

 * @param {Story} story

 * @param {string} backgroundDataUrl

 */

function buildCardHtml(

  story,

  backgroundDataUrl

) {

  const headline =

    story.headline ||

    "MATRIX 24";



  const category =

    story.category ||

    "WORLD NEWS";



  const sourceLabel =

    sourceLabelFromUrls(

      story.verified_source_urls ||

      []

    );



  const fontSize =

    headlineFontSize(headline);



  return `<!doctype html>

<html>

<head>

<meta charset="utf-8">



<style>



* {

  box-sizing: border-box;

}



html,

body {

  margin: 0;



  width: 1080px;

  height: 1350px;



  overflow: hidden;



  font-family:

    Arial,

    Helvetica,

    sans-serif;



  background:

    #080b10;



  color:

    #ffffff;

}



.card {

  width:

    1080px;



  height:

    1350px;



  position:

    relative;



  overflow:

    hidden;



  background:

    linear-gradient(

      to bottom,

      rgba(5,8,12,.18) 0%,

      rgba(5,8,12,.28) 42%,

      rgba(5,8,12,.96) 100%

    ),

    url("${backgroundDataUrl}")

      center center /

      cover

      no-repeat;

}



.grid {

  position:

    absolute;



  inset:

    0;



  opacity:

    .08;



  background-image:

    linear-gradient(

      rgba(255,255,255,.22) 1px,

      transparent 1px

    ),

    linear-gradient(

      90deg,

      rgba(255,255,255,.22) 1px,

      transparent 1px

    );



  background-size:

    72px 72px;

}



.vignette {

  position:

    absolute;



  inset:

    0;



  background:

    radial-gradient(

      circle at 50% 33%,

      transparent 18%,

      rgba(0,0,0,.10) 62%,

      rgba(0,0,0,.56) 100%

    );

}



.topbar {

  position:

    absolute;



  top:

    70px;



  left:

    72px;



  right:

    72px;



  display:

    flex;



  justify-content:

    space-between;



  align-items:

    center;



  gap:

    36px;

}



.brand {

  font-size:

    42px;



  font-weight:

    800;



  letter-spacing:

    3px;



  white-space:

    nowrap;



  text-shadow:

    0 2px 12px

    rgba(0,0,0,.55);

}



.category {

  font-size:

    22px;



  line-height:

    1.2;



  letter-spacing:

    1.8px;



  font-weight:

    700;


  opacity:

    .9;



  text-align:

    right;



  max-width:

    500px;



  text-shadow:

    0 2px 12px

    rgba(0,0,0,.55);

}



.headline {

  position:

    absolute;



  left:

    72px;



  right:

    72px;



  bottom:

    246px;



  font-size:

    ${fontSize}px;



  line-height:

    1.04;



  font-weight:

    800;



  letter-spacing:

    -1.8px;



  text-shadow:

    0 3px 18px

    rgba(0,0,0,.72);

}



.rule {

  position:

    absolute;



  left:

    72px;



  bottom:

    190px;



  width:

    180px;



  height:

    8px;



  background:

    #ffffff;



  box-shadow:

    0 2px 10px

    rgba(0,0,0,.45);

}



.source {

  position:

    absolute;



  left:

    72px;



  bottom:

    108px;



  font-size:

    25px;



  font-weight:

    600;



  opacity:

    .9;



  max-width:

    480px;



  text-shadow:

    0 2px 12px

    rgba(0,0,0,.6);

}



.ai-label {

  position:

    absolute;



  right:

    72px;



  bottom:

    104px;



  font-size:

    18px;



  line-height:

    1.3;



  font-weight:

    700;



  letter-spacing:

    .5px;



  opacity:

    .72;



  text-align:

    right;



  max-width:

    390px;



  text-shadow:

    0 2px 12px

    rgba(0,0,0,.65);

}



</style>

</head>



<body>



<div class="card">



  <div class="grid"></div>



  <div class="vignette"></div>



  <div class="topbar">



    <div class="brand">

      MATRIX 24

    </div>



    <div class="category">

      ${escapeHtml(

        category.toUpperCase()

      )}

    </div>



  </div>



  <div class="headline">

    ${escapeHtml(headline)}

  </div>



  <div class="rule"></div>



  <div class="source">

    Sources:

    ${escapeHtml(sourceLabel)}

  </div>



  <div class="ai-label">

    AI-GENERATED EDITORIAL VISUAL

    <br>

    NOT DOCUMENTARY PHOTOGRAPHY

  </div>



</div>



</body>

</html>`;

}



/**

 * @param {Story} story

 * @param {any} env

 */

async function renderFinalJpeg(

  story,

  env

) {

  const background =

    await generateBackground(

      story,

      env

    );



  const html =

    buildCardHtml(

      story,

      background.dataUrl

    );



  const screenshotResponse =

    await env.BROWSER.quickAction(

      "screenshot",

      {

        html,



        viewport: {

          width:

            1080,



          height:

            1350,

        },



        screenshotOptions: {

          type:

            "jpeg",



          quality:

            92,



          fullPage:

            false,

        },

      }

    );



  if (

    !screenshotResponse?.ok

  ) {

    throw new Error(

      `Browser Run screenshot failed: ${

        screenshotResponse?.status ||

        "unknown"

      }`

    );

  }



  const jpegBytes =

    new Uint8Array(

      await screenshotResponse

        .arrayBuffer()

    );



  if (

    !isJpeg(jpegBytes)

  ) {

    throw new Error(

      "Browser Run did not return a real JPEG"

    );

  }



  if (

    !jpegBytes.byteLength

  ) {

    throw new Error(

      "Rendered JPEG is empty"

    );

  }



  if (

    jpegBytes.byteLength >

    MAX_JPEG_BYTES

  ) {

    throw new Error(

      `Rendered JPEG exceeds 8 MB (${jpegBytes.byteLength} bytes)`

    );

  }



  return jpegBytes;

}



/**

 * @param {Uint8Array} jpegBytes

 * @param {string} filename

 * @param {any} env

 */

async function uploadJpegToSupabase(

  jpegBytes,

  filename,

  env

) {

  const uploadUrl =

    `${storageBase(env)}/storage/v1/object/` +

    `${env.SUPABASE_BUCKET}/${filename}`;



  const uploadResponse =

    await fetch(

      uploadUrl,

      {

        method:

          "POST",

        redirect: "error",

        signal: AbortSignal.timeout(15000),



        headers: {

          Authorization:

            `Bearer ${env.SUPABASE_SECRET_KEY}`,



          apikey:

            env.SUPABASE_SECRET_KEY,



          "Content-Type":

            "image/jpeg",



          "x-upsert":

            "false",

        },



        body:

          jpegBytes,

      }

    );



  const uploadText =

    await uploadResponse.text();



  if (

    !uploadResponse.ok

  ) {

    throw new Error(

      `STORAGE_UPLOAD_FAILED_${uploadResponse.status}`

    );

  }



  const publicUrl =

    `${storageBase(env)}/storage/v1/object/public/` +

    `${env.SUPABASE_BUCKET}/${filename}`;



  if (!(await existingJpeg(publicUrl))) throw new SafeError('MEDIA_RECONCILIATION_REQUIRED');



  return publicUrl;

}





/** Atomic GitHub SHA claim precedes all paid or storage operations.

 * Claims never expire automatically: an interrupted run needs reconciliation.

 */

async function processQueue(env) {

  let record = null; let claimed = false;

  const requestId = crypto.randomUUID();

  try {

    const records = await getQueueState(env);

    if (records.some(r => r.error)) throw new SafeError('QUEUE_READ_FAILED');

    const ids = new Set();

    for (const r of records) {

      const id = r.story?.content_id;

      if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new SafeError('QUEUE_ID_INVALID_OR_DUPLICATE');

      ids.add(id);

    }

    record = selectQueueRecord(records);

    if (!record?.story) return {success:true, action:'none', pending_recovery:records.filter(r => r.story?.status === 'processing_media').length};

    const story = record.story;

    if (!story.headline || !Array.isArray(story.verified_source_urls) || !story.verified_source_urls.length) throw new SafeError('QUEUE_CONTENT_INVALID');

    const priorUrl = story.public_image_url ? checkedImageUrl(story.public_image_url, env) : null;

    const filename = `matrix24-${await sha256(story.content_id)}-v1.jpg`;

    const publicUrl = priorUrl || `${storageBase(env)}/storage/v1/object/public/${env.SUPABASE_BUCKET}/${filename}`;

    story.status = 'processing_media';

    story.media_claim = {id:requestId, started_at:nowIso()};

// A lost claim response leaves a durable reservation; never retry blindly.

    await updateQueueFile(record, env, `MATRIX 24: reserve ${story.content_id}`);

    claimed = true;

    let bytes = null;

    const exists = await existingJpeg(publicUrl);

    if (!exists) {

      if (priorUrl) throw new SafeError('EXISTING_MEDIA_MISSING');

      bytes = await renderFinalJpeg(story, env);

      await uploadJpegToSupabase(bytes, filename, env);

    }

    story.status = 'ready_to_publish';

    story.public_image_url = publicUrl;

    story.image_filename = priorUrl ? story.image_filename : filename;

    story.media_ready_at = nowIso();

    if (bytes) story.image_spec = {format:'JPEG', mode:'RGB', width:1080, height:1350, size_bytes:bytes.length, alpha:false};

    delete story.media_claim;

    appendAttempt(story, {stage:'media_pipeline', result:exists ? 'reused_existing_media' : 'success', request_id:requestId, image_filename:story.image_filename, public_image_url:publicUrl});

    await updateQueueFile(record, env, `MATRIX 24: media ready for ${story.content_id}`);

    return {success:true, action:exists ? 'already_ready' : 'media_created', content_id:story.content_id, public_image_url:publicUrl};

  }  catch (error) {

// Preserve safe state. Do not retry or overwrite anything here.

  const code =

    error instanceof SafeError

      ? error.code

      : claimed

        ? 'MEDIA_RECONCILIATION_REQUIRED'

        : 'QUEUE_OR_CLAIM_FAILED';



  const rawMessage =

    error && error.message

      ? String(error.message)

      : 'Unknown error';



// Basic sanitization: never expose credentials in logs.

  const safeMessage = rawMessage

    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')

    .replace(/token[=:]\s*[^\s"']+/gi, 'token=[REDACTED]')

    .replace(/apikey[=:]\s*[^\s"']+/gi, 'apikey=[REDACTED]');



  console.error(JSON.stringify({

    event: 'matrix24_media_failed',

    request_id: requestId,

    code,

    claimed,

    error_name: error?.name || 'Error',

    error_message: safeMessage,

    queue_file: record?.path || record?.item?.name || null,

    content_id: record?.story?.content_id || null

  }));



  return {

    success: false,

    action: 'media_failed',

    error: code,

    request_id: requestId

  };

}

}



async function legacyUpload(request, env, url) {

  let bytes;

  const source = url.searchParams.get('image_url');

  if (source) {

    const safeUrl = checkedImageUrl(source, env);

    const response = await fetch(safeUrl, {redirect:'error', signal:AbortSignal.timeout(15000)});

    if (!response.ok) throw new SafeError('IMAGE_DOWNLOAD_FAILED', 400);

    bytes = await boundedBytes(response);

  } else {

    if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'image/jpeg') throw new SafeError('JPEG_REQUIRED', 415);

    bytes = await boundedBytes(request);

  }

  if (!isJpeg(bytes)) throw new SafeError('JPEG_REQUIRED', 415);

// Repeated upload of identical bytes reuses the same object.

  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');

  const filename = `upload-${digest}.jpg`;

  const publicUrl = `${storageBase(env)}/storage/v1/object/public/${env.SUPABASE_BUCKET}/${filename}`;

  if (!(await existingJpeg(publicUrl))) {

    try { await uploadJpegToSupabase(bytes, filename, env); }

    catch (error) { if (!(await existingJpeg(publicUrl))) throw error; }

  }

  return json({success:true, filename, public_url:publicUrl, bytes:bytes.length, content_type:'image/jpeg', verified_public:true});

}





export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    const method = request.method.toUpperCase();

    if (method === 'GET' && ['/', '/health'].includes(url.pathname)) return json({status:'ok', service:'matrix24-publisher'});

// Diagnostic routes are absent in production, including expensive AI/browser tests.

    if (!['/process-queue','/upload','/'].includes(url.pathname)) return json({error:'Not found'},404);

    if (method !== 'POST') return new Response(JSON.stringify({error:'Method not allowed'}), {status:405, headers:{'allow':'POST','content-type':'application/json','cache-control':'no-store'}});
    if (!(await authorized(request, env))) return json({error:'Unauthorized'},401);

    try {

      if (url.pathname === '/process-queue') {

        const result = await processQueue(env);

        return json(result, result.success ? 200 : 503);

      }

      return await legacyUpload(request, env, url);

    } catch (error) {

      const id = crypto.randomUUID();

      const code = error instanceof SafeError ? error.code : 'REQUEST_FAILED';

      console.error(JSON.stringify({event:'matrix24_request_failed', request_id:id, code}));

      return json({error:code, request_id:id}, error instanceof SafeError ? error.status : 500);

    }

  },

  async scheduled(_controller, env, ctx) { ctx.waitUntil(processQueue(env)); },

};