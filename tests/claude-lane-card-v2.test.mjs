import test from 'node:test';
import assert from 'node:assert/strict';
import { cardHtml, highlight } from '../claude-lane/render/card-html.mjs';
import { buildPrompt, generateImage, SAFETY } from '../claude-lane/render/ai-image.mjs';
import { validateLaneRecord, composeCaption, AI_NOTE } from '../scripts/claude-lane/lane-record.mjs';
import { adoptDraft } from '../scripts/claude-lane/run-lane.mjs';

const base = () => ({
  lane: 'claude', content_id: 'claude-20261006-laos-facility', status: 'draft', created_at: '2026-10-06T12:00:00Z',
  category: 'Security / Geopolitics', headline: 'Military aircraft arrive at new China-Laos facility',
  headline_es: 'Aviones militares llegan a nueva instalación China-Laos', caption_es: 'Texto <b>.', caption_en: 'Text.',
  source_urls: ['https://reuters.com/a', 'https://apnews.com/b'], source_names: ['Reuters', 'AP'], hashtags: ['#MATRIX24'],
  image_url: null, publish_attempt_id: null, ig_media_id: null, history: [],
  summary_es: 'Resumen corto.', summary_en: 'Short summary.', highlight_es: 'China-Laos', highlight_en: 'China-Laos facility',
  image_prompt: 'Three grey jet trainers parked on an airfield apron at dusk', visual_label: 'K-8',
  map: { focus: ['Laos'], marker: { lat: 20.2, lon: 101.9, label: 'Ban Keun' } },
});

test('visual fields validate; bad ones are rejected', () => {
  assert.deepEqual(validateLaneRecord(base()), []);
  assert.ok(validateLaneRecord({ ...base(), summary_es: 'x'.repeat(301) }).includes('BAD_SUMMARY_ES'));
  assert.ok(validateLaneRecord({ ...base(), map: { focus: 'Laos' } }).includes('BAD_MAP'));
  assert.ok(validateLaneRecord({ ...base(), map: { focus: ['Laos'], marker: { lat: 200, lon: 1 } } }).includes('BAD_MAP'));
  assert.ok(validateLaneRecord({ ...base(), ai_illustration: 'yes' }).includes('BAD_AI_ILLUSTRATION'));
});

test('caption carries the AI note only when an AI illustration is used', () => {
  assert.equal(composeCaption(base()).includes(AI_NOTE), false);
  assert.equal(composeCaption({ ...base(), ai_illustration: true }).includes(AI_NOTE), true);
});

test('adoption keeps the visual fields', () => {
  const r = adoptDraft({ ...base(), ai_illustration: true }, new Date('2026-10-06T12:30:00Z'));
  assert.equal(r.image_prompt, base().image_prompt); assert.deepEqual(r.map, base().map); assert.equal(r.ai_illustration, undefined);
});

test('template escapes text, highlights phrases and labels AI imagery', () => {
  assert.equal(highlight('a <b> China-Laos x', 'china-laos'), 'a &lt;b&gt; <span class="hl">China-Laos</span> x');
  const withImg = cardHtml(base(), { imageDataUrl: 'data:image/jpeg;base64,AAAA' });
  assert.match(withImg, /Ilustración IA · AI illustration/);
  assert.match(withImg, /<span class="hl">China-Laos<\/span>/);
  assert.doesNotMatch(cardHtml(base(), {}), /Ilustración IA/);
  assert.match(cardHtml(base(), {}), /Source: Reuters, AP/);
});

test('AI prompt always carries the safety rules; failures return null', async () => {
  assert.ok(buildPrompt('a ship at sea').includes(SAFETY));
  assert.equal(await generateImage('x', { token: null, accountId: 'a' }), null);
  assert.equal(await generateImage('x', { token: 't', accountId: 'a', fetchImpl: async () => ({ ok: false, json: async () => ({}) }) }), null);
  const img = Buffer.alloc(2000, 1).toString('base64');
  let sent;
  const buf = await generateImage('x', { token: 't', accountId: 'acc', fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ result: { image: img } }) }; } });
  assert.equal(buf.length, 2000);
  assert.match(sent.url, /accounts\/acc\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/);
  assert.equal(sent.body.steps, 4);
});

let mapMod = null;
try { mapMod = await import('../claude-lane/render/map-svg.mjs'); } catch { mapMod = null; }
const skipMap = !mapMod && process.env.CLAUDE_LANE_REQUIRE_RENDER !== '1' && 'render dependencies not installed';
test('locator map highlights the focus country and draws the marker', { skip: skipMap }, () => {
  const svg = mapMod.mapSvg({ focus: ['Laos'], marker: { lat: 20.2, lon: 101.9, label: 'Ban Keun' } });
  assert.match(svg, /class="focus"/); assert.match(svg, /BAN KEUN/); assert.match(svg, /LAOS/);
  assert.equal(mapMod.mapSvg({ focus: ['Atlantis'] }), null);
  assert.ok(mapMod.findCountry('United States'));
});
