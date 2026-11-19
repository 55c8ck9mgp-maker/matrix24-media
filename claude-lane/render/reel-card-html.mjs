// MATRIX 24 Claude Lane Reel card — 1080×1920 HTML. Pure function: record + assets → HTML.
// V2.0 — native Reel dimensions, hero image full-bleed, branded footer bar,
//        hashtag row, bolder typography, ambient glow.
// IMPORTANT: This template is Reel-only. Static 1080×1350 posts use card-html.mjs.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function highlightReel(text, phrase, cls = 'hl') {
  const t = esc(text);
  if (!phrase) return t;
  const p = esc(phrase);
  const i = t.toLowerCase().indexOf(p.toLowerCase());
  return i < 0 ? t : `${t.slice(0, i)}<span class="${cls}">${t.slice(i, i + p.length)}</span>${t.slice(i + p.length)}`;
}

export function fmtDateReel(iso) {
  const d = new Date(iso);
  const m = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'][d.getUTCMonth()];
  return `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * Build a 1080×1920 HTML card for Reel rendering.
 * @param {object} r            Lane record.
 * @param {object} opts
 * @param {string|null} opts.imageDataUrl   data: URI for the AI illustration (optional).
 * @param {string|null} opts.mapSvg         Locator-map SVG markup (optional).
 * @returns {string}
 */
export function reelCardHtml(r, { imageDataUrl = null, mapSvg = null } = {}) {
  const es      = r.headline_es || r.headline;
  const en      = r.headline;
  const sumEs   = r.summary_es  || r.caption_es || '';
  const sumEn   = r.summary_en  || r.caption_en || '';
  const hasMap  = Boolean(mapSvg);
  const hasImg  = Boolean(imageDataUrl);

  // Responsive font sizing — Anton uppercase for maximum punch.
  const esSize = es.length > 90 ? 60 : es.length > 65 ? 70 : 82;
  const enSize = en.length > 90 ? 36 : en.length > 65 ? 42 : 48;

  // Top hashtags from the record (max 4 shown in card).
  const tags = Array.isArray(r.hashtags) ? r.hashtags.slice(0, 4) : [];

  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}

/* ── Root canvas ── */
body{
  width:1080px;height:1920px;
  background:#070b16;color:#fff;
  font-family:Inter,Arial,sans-serif;
  overflow:hidden;position:relative;
}

/* ── Hero image (full-bleed, upper 55 %) ── */
.hero{
  position:absolute;left:0;right:0;top:0;height:1056px;
  background:${hasImg ? `url('${imageDataUrl}') center/cover no-repeat` : '#0d1322'};
}
/* Four-stop gradient: opaque top (logo reads) → transparent mid → semi mid-lower → opaque bottom */
.hero:after{
  content:"";position:absolute;inset:0;
  background:
    linear-gradient(180deg,
      rgba(7,11,22,1)       0%,
      rgba(7,11,22,.0)     22%,
      rgba(7,11,22,.05)    55%,
      rgba(7,11,22,.72)    75%,
      rgba(7,11,22,1)      100%);
}

/* ── Ambient glow (top-right, branded red) ── */
.glow{
  position:absolute;inset:0;
  background:radial-gradient(1100px 600px at 90% 8%,rgba(193,18,31,.20),transparent 60%);
  pointer-events:none;
}
/* Second glow — lower left for depth */
.glow2{
  position:absolute;inset:0;
  background:radial-gradient(700px 400px at 10% 85%,rgba(193,18,31,.10),transparent 60%);
  pointer-events:none;
}

/* ── Header ── */
header{
  position:absolute;top:40px;left:60px;right:60px;
  display:flex;justify-content:space-between;align-items:flex-start;
}
.logo{font:400 72px/0.9 Anton,Impact,sans-serif;letter-spacing:2px}
.logo b{color:#e11d2a;font-weight:400}
.logo small{
  display:block;font:600 19px Oswald,Arial;
  letter-spacing:13px;color:#fff;
  margin-top:9px;padding-top:7px;
  border-top:3px solid #e11d2a;
  width:320px;text-align:right;
}
nav{font:500 15px Oswald,Arial;letter-spacing:5px;color:#c8d0e0;margin-top:16px}
.brk{
  background:#e11d2a;color:#fff;
  font:700 23px Oswald,Arial;letter-spacing:3px;
  padding:10px 20px;margin-top:10px;text-transform:uppercase;
}

/* ── Breaking badge (top-left badge position when no nav) ── */

/* ── Category tag ── */
.cat{
  position:absolute;top:1050px;left:60px;
  background:#e11d2a;
  font:700 21px Oswald,Arial;letter-spacing:3px;
  padding:7px 18px;text-transform:uppercase;
}

/* ── Locator map (top-right, overlaps hero) ── */
.map{
  position:absolute;top:140px;right:50px;
  width:400px;height:420px;
  border-radius:8px;overflow:hidden;
  box-shadow:0 0 0 2px rgba(225,29,42,.7),0 12px 44px rgba(0,0,0,.7);
}

/* ── Headline block ── */
.heads{
  position:absolute;
  top:1115px;
  left:60px;right:${hasMap ? 460 : 60}px;
}
.h-es{
  border-left:9px solid #e11d2a;padding-left:24px;
  font:400 ${esSize}px/1.02 Anton,Impact,sans-serif;
  text-transform:uppercase;
  text-shadow:0 4px 16px rgba(0,0,0,.7);
}
.h-en{
  margin-top:22px;
  border-left:9px solid #e11d2a;padding-left:24px;
  font:400 ${enSize}px/1.1 Anton,Impact,sans-serif;
  text-transform:uppercase;color:#e8ecf5;
  text-shadow:0 3px 12px rgba(0,0,0,.55);
}
.hl{color:#ffcc00}

/* ── Summary columns ── */
.cols{
  position:absolute;top:1480px;left:60px;right:60px;
  display:flex;gap:40px;
}
.col{
  flex:1;border-left:5px solid #e11d2a;padding-left:17px;
  font:400 24px/1.4 Inter,Arial;color:#dde2ee;
  display:-webkit-box;-webkit-line-clamp:5;
  -webkit-box-orient:vertical;overflow:hidden;
}
.col .hl{font-weight:700}

/* ── AI illustration tag ── */
.aitag{
  position:absolute;top:1038px;right:60px;
  border:2px solid #e11d2a;background:rgba(7,11,22,.88);
  padding:9px 15px;font:600 15px Oswald,Arial;
  letter-spacing:1px;color:#e6e9f0;text-transform:uppercase;
}
.aitag b{font:400 25px Anton,Arial;color:#fff;margin-right:10px;letter-spacing:1px}

/* ── Footer bar ── */
footer{
  position:absolute;bottom:0;left:0;right:0;height:140px;
  background:linear-gradient(180deg,rgba(7,11,22,.0) 0%,rgba(7,11,22,1) 30%);
  display:flex;align-items:flex-end;
  padding:0 60px 32px;
  justify-content:space-between;
}
/* Red accent line above footer */
footer:before{
  content:"";position:absolute;top:30px;left:60px;right:60px;
  height:2px;background:#e11d2a;opacity:.6;
}
.footer-left{display:flex;flex-direction:column;gap:6px}
.src{font:600 22px Inter,Arial}
.src span{color:#8a98b8;font-weight:400}
.hashtags{font:500 18px Oswald,Arial;color:#8a98b8;letter-spacing:1px}
.footer-right{text-align:right}
.brand{font:500 15px Oswald,Arial;letter-spacing:7px;padding-bottom:7px;border-bottom:3px solid #e11d2a}
.dateline{font:400 17px Inter,Arial;color:#8a98b8;margin-top:8px}
</style></head><body>

<div class="hero"></div>
<div class="glow"></div>
<div class="glow2"></div>

<header>
  <div class="logo">MATRIX <b>24</b><small>GLOBAL</small></div>
  ${r.breaking === true
    ? '<div class="brk">Última hora · Breaking</div>'
    : '<nav>NOTICIAS | ANÁLISIS | CONTEXTO GLOBAL</nav>'}
</header>

${hasMap ? `<div class="map">${mapSvg}</div>` : ''}

<div class="cat">${esc(r.category || 'World')}</div>
${hasImg ? `<div class="aitag">${r.visual_label ? `<b>${esc(r.visual_label)}</b>` : ''}Ilustración IA · AI illustration</div>` : ''}

<div class="heads">
  <div class="h-es">${highlightReel(es, r.highlight_es)}</div>
  <div class="h-en">${highlightReel(en, r.highlight_en)}</div>
</div>

<div class="cols">
  <div class="col">${highlightReel(sumEs, r.highlight_summary_es)}</div>
  <div class="col">${highlightReel(sumEn, r.highlight_summary_en)}</div>
</div>

<footer>
  <div class="footer-left">
    <div class="src">Fuente <span>|</span> Source: ${esc((r.source_names || []).join(', '))} <span>— ${fmtDateReel(r.created_at)}</span></div>
    ${tags.length > 0 ? `<div class="hashtags">${tags.map(esc).join(' ')}</div>` : ''}
  </div>
  <div class="footer-right">
    <div class="brand">MATRIX 24 GLOBAL</div>
    <div class="dateline">${esc(r.category || 'World')}</div>
  </div>
</footer>

</body></html>`;
}
