import test from 'node:test';
import assert from 'node:assert/strict';
import { summarySlideHtml, sourcesSlideHtml } from '../claude-lane/render/carousel-html.mjs';

const r = { headline: 'Fire <spreads> in town', summary_es: 'Resumen <b>', summary_en: 'Summary & more',
  source_names: ['Reuters', 'AP <x>'], caption_es: 'x', caption_en: 'y' };

test('summary slide shows both languages and escapes markup', () => {
  const h = summarySlideHtml(r);
  assert.match(h, /Resumen &lt;b&gt;/);
  assert.match(h, /Summary &amp; more/);
  assert.equal(h.includes('<b>'), false);
});
test('sources slide lists each source once, escaped, with the two-source note', () => {
  const h = sourcesSlideHtml(r);
  assert.match(h, /<li>Reuters<\/li>/);
  assert.match(h, /AP &lt;x&gt;/);
  assert.match(h, /two independent sources/);
});
test('slides are 1080x1350 with no missing fields', () => {
  assert.match(summarySlideHtml({}), /1080px/);
  assert.match(sourcesSlideHtml({}), /<ol><\/ol>/);
});
