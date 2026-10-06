#!/usr/bin/env node
// Renders a Claude Lane record to a 1080x1350 JPEG with headless Chromium.
// usage: render-card.mjs <record.json> <out.jpg> [illustration.jpg]
import fs from 'node:fs';
import { chromium } from 'playwright';
import { cardHtml } from './card-html.mjs';
import { mapSvg } from './map-svg.mjs';

export async function renderCard(record, { illustration = null } = {}) {
  let svg = null;
  try { svg = record.map ? mapSvg({ focus: record.map.focus || [], marker: record.map.marker || null, labels: record.map.labels || {} }) : null; } catch { svg = null; }
  const imageDataUrl = illustration ? `data:image/jpeg;base64,${illustration.toString('base64')}` : null;
  const html = cardHtml(record, { mapSvg: svg, imageDataUrl });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 5000))]));
    return await page.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
  } finally { await browser.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , inp, out, ill] = process.argv;
  const rec = JSON.parse(fs.readFileSync(inp, 'utf8'));
  renderCard(rec, { illustration: ill ? fs.readFileSync(ill) : null }).then(b => fs.writeFileSync(out, b));
}
