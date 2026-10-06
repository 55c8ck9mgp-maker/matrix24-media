import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mediaUrl, mediaPath } from '../scripts/claude-lane/media-url.mjs';

const base = {
  lane: 'claude', content_id: 'claude-20261006-render-test', status: 'draft', created_at: '2026-10-06T12:00:00Z',
  category: 'World', headline: 'A long English headline that needs to wrap across several lines to test the fitting logic properly',
  headline_es: 'Un titular en español muy largo que necesita dividirse en varias líneas para probar el ajuste del texto en la tarjeta',
  caption_es: 'x', caption_en: 'y', source_urls: ['https://a.com/1', 'https://b.com/2'], source_names: ['Reuters', 'AP'],
  hashtags: [], image_url: null, publish_attempt_id: null, ig_media_id: null, history: [],
};

// Pillow is installed only by Claude Lane CI (which sets CLAUDE_LANE_REQUIRE_RENDER=1
// so a missing dependency fails there). Other suites that run tests/*.test.mjs
// skip the render check instead of failing for an unrelated missing package.
let hasPillow = true;
try { execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); } catch { hasPillow = false; }
const skipRender = !hasPillow && process.env.CLAUDE_LANE_REQUIRE_RENDER !== '1' && 'Pillow not installed';

test('renders a 1080x1350 JPEG under Instagram limits, also for very long headlines', { skip: skipRender }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-'));
  for (const [name, rec] of [['n', base], ['long', { ...base, headline_es: 'Palabra '.repeat(60), headline: 'Word '.repeat(60) }]]) {
    const inp = path.join(dir, `${name}.json`); const out = path.join(dir, `${name}.jpg`);
    fs.writeFileSync(inp, JSON.stringify(rec));
    execFileSync('python3', ['scripts/claude-lane/render_card.py', inp, out]);
    const buf = fs.readFileSync(out);
    assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8); // JPEG magic
    assert.ok(buf.length < 8 * 1024 * 1024);
    const dims = execFileSync('python3', ['-c', `from PIL import Image;print(Image.open(${JSON.stringify(out)}).size)`]).toString().trim();
    assert.equal(dims, '(1080, 1350)');
  }
});

test('media URL is the public raw path on main for a valid lane id only', () => {
  assert.equal(mediaPath('claude-20261006-x'), 'claude-lane/media/claude-20261006-x.jpg');
  assert.equal(mediaUrl('claude-20261006-x'),
    'https://raw.githubusercontent.com/55c8ck9mgp-maker/matrix24-media/main/claude-lane/media/claude-20261006-x.jpg');
  assert.throws(() => mediaPath('../queue/x'), /BAD_CONTENT_ID/);
});
