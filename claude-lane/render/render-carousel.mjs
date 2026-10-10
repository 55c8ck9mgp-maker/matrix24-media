#!/usr/bin/env node
// Renders the 3 carousel slides for a record: [card, summary, sources] as 1080x1350 JPEGs.
// Slide 1 reuses the normal card renderer. Usage: render-carousel.mjs <record.json> <outdir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { cardHtml } from './card-html.mjs';
import { mapSvg } from './map-svg.mjs';
import { summarySlideHtml, sourcesSlideHtml } from './carousel-html.mjs';

async function shot(browser, html) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 5000))]));
    return await page.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
  } finally { await page.close(); }
}

export async function renderCarousel(record) {
  let svg = null;
  try { svg = record.map ? mapSvg({ focus: record.map.focus || [], marker: record.map.marker || null, labels: record.map.labels || {} }) : null; } catch { svg = null; }
  const browser = await chromium.launch();
  try {
    return [
      await shot(browser, cardHtml(record, { mapSvg: svg, imageDataUrl: null })),
      await shot(browser, summarySlideHtml(record)),
      await shot(browser, sourcesSlideHtml(record)),
    ];
  } finally { await browser.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , inp, outDir] = process.argv;
  const rec = JSON.parse(fs.readFileSync(inp, 'utf8'));
  renderCarousel(rec).then(bufs => bufs.forEach((b, i) => fs.writeFileSync(path.join(outDir, `slide-${i + 1}.jpg`), b)));
}
