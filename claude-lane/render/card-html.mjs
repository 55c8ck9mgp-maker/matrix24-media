// MATRIX 24 Claude Lane card, 1080x1350 HTML. Pure function: record + assets -> HTML.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Wraps the first case-insensitive occurrence of `phrase` in a highlight span.
export function highlight(text, phrase, cls = 'hl') {
  const t = esc(text);
  if (!phrase) return t;
  const p = esc(phrase);
  const i = t.toLowerCase().indexOf(p.toLowerCase());
  return i < 0 ? t : `${t.slice(0, i)}<span class="${cls}">${t.slice(i, i + p.length)}</span>${t.slice(i + p.length)}`;
}

export function fmtDate(iso) {
  const d = new Date(iso);
  const m = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'][d.getUTCMonth()];
  return `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function cardHtml(r, { mapSvg = null, imageDataUrl = null } = {}) {
  const hasMap = Boolean(mapSvg);
  const es = r.headline_es || r.headline;
  const sumEs = r.summary_es || r.caption_es;
  const sumEn = r.summary_en || r.caption_en;
  const esSize = es.length > 85 ? 58 : es.length > 60 ? 66 : 76;
  const enSize = r.headline.length > 85 ? 34 : 40;
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1350px;background:#070b16;color:#fff;font-family:Inter,Arial,sans-serif;overflow:hidden;position:relative}
.bgimg{position:absolute;left:0;right:0;top:${hasMap ? 520 : 470}px;height:560px;background:url('${imageDataUrl || ''}') center/cover no-repeat;${imageDataUrl ? '' : 'display:none'}}
.bgimg:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#070b16 0%,rgba(7,11,22,.15) 22%,rgba(7,11,22,.1) 70%,#070b16 100%)}
.glow{position:absolute;inset:0;background:radial-gradient(900px 500px at 85% 10%,rgba(193,18,31,.18),transparent 60%)}
header{position:absolute;top:36px;left:56px;right:56px;display:flex;justify-content:space-between;align-items:flex-start}
.logo{font:400 64px/0.9 Anton,Impact,sans-serif;letter-spacing:2px}.logo b{color:#e11d2a;font-weight:400}
.logo small{display:block;font:600 18px Oswald,Arial;letter-spacing:12px;color:#fff;margin-top:8px;padding-top:6px;border-top:3px solid #e11d2a;width:300px;text-align:right}
nav{font:500 15px Oswald,Arial;letter-spacing:5px;color:#c8d0e0;margin-top:14px}
.heads{position:absolute;top:150px;left:56px;width:${hasMap ? 560 : 968}px}
.h-es{border-left:8px solid #e11d2a;padding-left:22px;font:400 ${esSize}px/1.02 Anton,Impact,sans-serif;text-transform:uppercase;text-shadow:0 3px 12px rgba(0,0,0,.6)}
.h-en{margin-top:22px;border-left:8px solid #e11d2a;padding-left:22px;font:400 ${enSize}px/1.08 Anton,Impact,sans-serif;text-transform:uppercase;color:#f2f4f8}
.hl{color:#ffcc00}
.map{position:absolute;top:120px;right:40px;width:420px;height:440px;border-radius:6px;overflow:hidden;box-shadow:0 0 0 2px rgba(225,29,42,.6),0 10px 40px rgba(0,0,0,.6)}
.cat{position:absolute;top:${hasMap ? 1000 : 950}px;left:56px;background:#e11d2a;font:700 20px Oswald,Arial;letter-spacing:3px;padding:6px 16px;text-transform:uppercase}
.tag{position:absolute;top:${hasMap ? 990 : 940}px;right:56px;border:2px solid #e11d2a;background:rgba(7,11,22,.85);padding:8px 14px;font:600 15px Oswald,Arial;letter-spacing:1px;color:#e6e9f0;text-transform:uppercase}
.tag b{font:400 24px Anton,Arial;color:#fff;margin-right:10px;letter-spacing:1px}
.cols{position:absolute;top:1080px;left:56px;right:56px;display:flex;gap:44px}
.col{flex:1;border-left:5px solid #e11d2a;padding-left:16px;font:400 22px/1.38 Inter,Arial;color:#e8ebf2;display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden;max-height:214px}
.col .hl{font-weight:700}
footer{position:absolute;bottom:34px;left:56px;right:56px;display:flex;justify-content:space-between;align-items:flex-end;font:600 21px Inter,Arial}
footer .src{border-left:5px solid #e11d2a;padding-left:14px}footer .src span{color:#9aa6bd;font-weight:400}
footer .brand{font:500 15px Oswald,Arial;letter-spacing:6px;border-bottom:3px solid #e11d2a;padding-bottom:6px}
</style></head><body>
<div class="bgimg"></div><div class="glow"></div>
<header><div class="logo">MATRIX <b>24</b><small>GLOBAL</small></div>${hasMap ? '' : '<nav>NOTICIAS | ANÁLISIS | CONTEXTO GLOBAL</nav>'}</header>
<div class="heads"><div class="h-es">${highlight(es, r.highlight_es)}</div><div class="h-en">${highlight(r.headline, r.highlight_en)}</div></div>
${hasMap ? `<div class="map">${mapSvg}</div>` : ''}
<div class="cat">${esc(r.category || 'World')}</div>
${imageDataUrl ? `<div class="tag">${r.visual_label ? `<b>${esc(r.visual_label)}</b>` : ''}Ilustración IA · AI illustration</div>` : ''}
<div class="cols"><div class="col">${highlight(sumEs, r.highlight_summary_es)}</div><div class="col">${highlight(sumEn, r.highlight_summary_en)}</div></div>
<footer><div class="src">Fuente <span>|</span> Source: ${esc((r.source_names || []).join(', '))} <span>— ${fmtDate(r.created_at)}</span></div><div class="brand">MATRIX 24 GLOBAL</div></footer>
</body></html>`;
}
