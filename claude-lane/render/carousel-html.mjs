// Carousel slides 2 and 3 for a Claude Lane story (slide 1 is the normal card).
// Pure functions: record -> 1080x1350 HTML. Same escaping rules as card-html.mjs.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const base = `
  :root { color-scheme: light dark; }
  html, body { margin: 0; width: 1080px; height: 1350px; overflow: hidden; }
  body { background: #0b1220; color: #f5f7fb; font-family: "Helvetica Neue", Arial, sans-serif; }
  .wrap { box-sizing: border-box; height: 1350px; padding: 96px 88px; display: flex; flex-direction: column; gap: 40px; }
  .tag { font-size: 30px; letter-spacing: 6px; text-transform: uppercase; color: #7dd3fc; }
  h1 { font-size: 64px; line-height: 1.12; margin: 0; }
  p { font-size: 40px; line-height: 1.4; margin: 0; }
  .es { color: #f5f7fb; } .en { color: #cbd5e1; font-size: 34px; }
  ol { font-size: 36px; line-height: 1.5; margin: 0; padding-left: 48px; }
  .foot { margin-top: auto; font-size: 26px; color: #94a3b8; }
`;

function page(body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${base}</style></head><body>${body}</body></html>`;
}

export function summarySlideHtml(r) {
  const es = esc(r.summary_es || r.caption_es || '');
  const en = esc(r.summary_en || r.caption_en || '');
  return page(`<div class="wrap">
    <div class="tag">Resumen · Summary</div>
    <p class="es">${es}</p>
    <p class="en">${en}</p>
    <div class="foot">MATRIX 24 · @matrix24global</div>
  </div>`);
}

export function sourcesSlideHtml(r) {
  const names = Array.isArray(r.source_names) ? r.source_names : [];
  const items = names.map(n => `<li>${esc(n)}</li>`).join('');
  return page(`<div class="wrap">
    <div class="tag">Fuentes · Sources</div>
    <ol>${items}</ol>
    <p class="en">Verificado con al menos dos fuentes independientes. Verified with at least two independent sources.</p>
    <div class="foot">MATRIX 24 · @matrix24global</div>
  </div>`);
}
